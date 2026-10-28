import json
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from camera_discovery import signature, validate_reply
from camera_source import CameraSource
from video_relay import VideoRelay, VideoError

KEY = 'a' * 64
NONCE = 'b' * 32
CAMERA_ID = '123456abcdef'
JPEG = b'\xff\xd8test\xff\xd9'


def wait_until(predicate, seconds=3):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if predicate():
                return
        except VideoError:
            pass
        time.sleep(.02)
    raise AssertionError('Timed out waiting for camera state')


class CameraPairingTests(unittest.TestCase):
    def test_signed_discovery_nonce_identity_and_endpoint(self):
        host = '192.168.1.21'
        reply = {'nonce': NONCE, 'id': CAMERA_ID, 'port': 81, 'path': '/stream', 'signature': signature(KEY, NONCE, CAMERA_ID, host, 81, '/stream')}
        encode = lambda value: json.dumps(value).encode()
        self.assertEqual(validate_reply(encode(reply), host, NONCE, KEY), {'url': f'http://{host}:81/stream', 'id': CAMERA_ID})
        for data, source, nonce, key, expected in (
            (reply, '192.168.1.22', NONCE, KEY, ''),
            (reply, host, 'c' * 32, KEY, ''),
            (reply, host, NONCE, 'd' * 64, ''),
            (reply, host, NONCE, KEY, '000000000000'),
            ({**reply, 'port': 80}, host, NONCE, KEY, ''),
            ({**reply, 'path': '/api/stop'}, host, NONCE, KEY, ''),
            (reply, '8.8.8.8', NONCE, KEY, ''),
            ([], host, NONCE, KEY, ''),
        ):
            self.assertIsNone(validate_reply(encode(data), source, nonce, key, expected))
        self.assertIsNone(validate_reply(b'not JSON', host, NONCE, KEY))

    def test_onboard_configuration_persists_without_token_or_motor_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'wifi.local.json').write_text(json.dumps({'ssid': 'test wifi', 'password': 'test password'}))
            motor = root / 'firmware/car_controller/config.h'
            motor.parent.mkdir(parents=True)
            motor.write_text('unchanged motor firmware settings')
            source = CameraSource(VideoRelay(), root / 'camera.local.json', paired_resolver=lambda: None)
            source.configure('', True)
            first = json.loads((root / 'camera.local.json').read_text())
            self.assertTrue(first['auto_discover'])
            self.assertEqual(first['source_mode'], 'onboard')
            self.assertNotIn('control_token', first)
            source.configure('http://127.0.0.1:1/capture', False)
            source.close()
            saved = json.loads((root / 'camera.local.json').read_text())
            self.assertEqual(saved['url'], 'http://127.0.0.1:1/capture')
            self.assertFalse(saved['auto_discover'])
            self.assertEqual(motor.read_text(), 'unchanged motor firmware settings')

    def test_discovery_reconnect_and_changed_address_remain_paired(self):
        online = [True]
        class Camera(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                self.send_response(200 if online[0] else 503)
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Content-Length', str(len(JPEG)))
                self.end_headers()
                self.wfile.write(JPEG)
        camera = ThreadingHTTPServer(('127.0.0.1', 0), Camera)
        threading.Thread(target=camera.serve_forever, daemon=True).start()
        video = VideoRelay()
        discovered = [None]
        expected_ids = []
        def discover(key, bind, expected, stopped):
            expected_ids.append(expected)
            self.assertEqual(key, KEY)
            return discovered[0]
        source = CameraSource(video, discovery_key=KEY, discovery_bind='192.168.1.11', discoverer=discover, retry_seconds=.05)
        try:
            source.configure('', True)
            wait_until(lambda: 'Waiting for paired' in source.status()['message'])
            discovered[0] = {'id': CAMERA_ID, 'url': f'http://127.0.0.1:{camera.server_port}/capture'}
            wait_until(lambda: video.snapshot()[0] == JPEG)
            self.assertEqual(source.camera_id, CAMERA_ID)
            online[0] = False
            wait_until(lambda: source.session == '')
            with self.assertRaises(VideoError):
                video.snapshot()
            discovered[0]['url'] = f'http://127.0.0.1:{camera.server_port}/new-address'
            online[0] = True
            wait_until(lambda: video.snapshot()[0] == JPEG and source.url.endswith('/new-address'))
            self.assertIn(CAMERA_ID, expected_ids, 'Reconnect is pinned to the first paired camera ID')
            self.assertNotIn('discovery_key', source.status())
            source.configure('')
            self.assertFalse(source.status()['auto_discover'])
            self.assertIsNone(source.worker)
        finally:
            source.close()
            camera.shutdown()
            camera.server_close()


if __name__ == '__main__':
    unittest.main()
