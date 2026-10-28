import concurrent.futures
import json
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Relay, RelayError, make_server
from heartbeat import IdleHeartbeat
from camera_source import CameraSource
from video_relay import VideoRelay, VideoError
from mock_esp import MockESP, TOKEN, mock_server


class S3TransportTests(unittest.TestCase):
    def setUp(self):
        self.mock = MockESP()
        self.esp = mock_server(self.mock)
        threading.Thread(target=self.esp.serve_forever, daemon=True).start()
        self.config = dict(esp_host='127.0.0.1', esp_port=self.esp.server_port, control_token=TOKEN)
        self.relay = Relay(self.config)
        self.arm = dict(owner='wheel', throttle=0, steering=0, neutral=True)

    def tearDown(self):
        self.esp.shutdown()
        self.esp.server_close()

    def test_idle_stream_without_page_never_arms_or_changes_nonce(self):
        heartbeat = IdleHeartbeat(self.relay)
        original_nonce = self.mock.nonce
        heartbeat.start()
        try:
            time.sleep(.3)
        finally:
            heartbeat.close()
        requests = self.mock.requests
        self.assertGreaterEqual(len(requests), 4)
        self.assertLessEqual(len(requests), 8, 'No catch-up burst')
        self.assertTrue(all(action == 'heartbeat' and data == {} for action, data, _ in requests))
        self.assertEqual(self.mock.nonce, original_nonce)
        self.assertFalse(self.mock.armed)
        self.assertEqual(self.relay.transport_state({})['traffic_mode'], 'idle-heartbeat')
        self.assertLess(self.relay.transport_state({})['heartbeat_age_ms'], 150)

    def test_arm_waits_for_inflight_heartbeat_controls_remain_fresh(self):
        entered, release = threading.Event(), threading.Event()
        command = self.mock.command
        def delayed(action, data):
            if action == 'heartbeat':
                entered.set()
                release.wait(.1)
            return command(action, data)
        self.mock.command = delayed
        with concurrent.futures.ThreadPoolExecutor() as pool:
            idle = pool.submit(self.relay.heartbeat)
            self.assertTrue(entered.wait(1))
            arming = pool.submit(self.relay.command, 'arm', self.arm)
            time.sleep(.02)
            release.set()
            idle.result()
            armed = arming.result()
        self.assertTrue(armed['armed'])
        self.assertIsNone(self.relay.heartbeat(), 'No idle traffic competes with armed input')
        for sequence in range(1, 5):
            state = self.relay.command('control', {**self.arm, 'session': armed['session'], 'seq': sequence})
            self.assertTrue(state['armed'])
            self.assertEqual(state['throttle'], 0)
        self.assertEqual(self.mock.seq, 4)
        self.assertEqual(state['traffic_mode'], 'fresh-controls')
        self.relay.command('stop')

    def test_heartbeat_does_not_extend_motor_deadline_or_sequence(self):
        state = self.relay.command('arm', self.arm)
        updated, sequence, nonce = self.mock.updated, self.mock.seq, self.mock.nonce
        for _ in range(3):
            self.relay.upstream('heartbeat', {})
        self.assertEqual((self.mock.updated, self.mock.seq, self.mock.nonce), (updated, sequence, nonce))
        time.sleep(.41)
        self.assertFalse(self.relay.upstream('heartbeat', {})['armed'])
        with self.assertRaises(RelayError):
            self.relay.command('control', {**self.arm, 'session': state['session'], 'seq': 1})

    def test_no_adoption_of_orphan_session(self):
        self.relay.command('arm', self.arm)
        self.relay.invalidate()
        self.assertFalse(self.relay.heartbeat()['armed'])
        self.assertEqual(self.mock.requests[-1][0], 'stop')
        self.assertIsNone(self.relay.active)

    def test_wrong_token_and_classic_identity_rejected(self):
        with self.assertRaises(RelayError):
            Relay({**self.config, 'control_token': 'other-package-token-' * 3}).upstream('status')
        state = self.mock.state
        self.mock.state = lambda: {**state(), 'board': 'esp32-classic'}
        with self.assertRaisesRegex(RelayError, 'Wrong board'):
            self.relay.upstream('status')
        self.assertFalse(self.mock.armed)

    def test_paired_camera_ignores_untrusted_host_and_path(self):
        self.relay.last_state = dict(camera=dict(ready=True, host='8.8.8.8', port=81, path='/stream'))
        self.relay.last_state_at = time.monotonic()
        self.assertEqual(self.relay.paired_camera(), ('http://127.0.0.1:81/stream', TOKEN))
        self.relay.last_state['camera']['path'] = '/redirect'
        self.assertIsNone(self.relay.paired_camera())
        self.relay.last_state['camera']['path'] = '/stream'
        self.relay.last_state_at -= 3
        self.assertIsNone(self.relay.paired_camera())

    def test_failed_heartbeat_never_replays_controls_or_arms(self):
        with patch.object(self.relay, 'upstream', side_effect=RelayError('offline')) as request:
            with self.assertRaises(RelayError):
                self.relay.heartbeat()
            self.assertEqual(request.call_args.args, ('heartbeat', {}))
        self.assertIsNone(self.relay.active)
        self.assertFalse(self.relay.heartbeat()['armed'])
        self.assertTrue(all(action == 'heartbeat' for action, _, _ in self.mock.requests))

    def test_invalid_browser_heartbeat_cannot_stop_owner(self):
        self.relay.command('arm', self.arm)
        server = make_server(self.relay, 0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        before = len(self.mock.requests)
        try:
            with self.assertRaises(urllib.error.HTTPError) as error:
                http.open(urllib.request.Request(f'http://127.0.0.1:{server.server_port}/api/heartbeat', data=b'bad'))
            self.assertEqual(error.exception.code, 400)
            self.assertEqual(before, len(self.mock.requests))
            self.assertTrue(self.mock.armed)
        finally:
            server.shutdown()
            server.server_close()

    def test_stop_racing_heartbeat_and_arm_stays_disarmed(self):
        entered, release = threading.Event(), threading.Event()
        command = self.mock.command
        def delayed(action, data):
            if action == 'heartbeat':
                entered.set()
                release.wait(.12)
            return command(action, data)
        self.mock.command = delayed
        with concurrent.futures.ThreadPoolExecutor() as pool:
            idle = pool.submit(self.relay.heartbeat)
            self.assertTrue(entered.wait(1))
            arm = pool.submit(self.relay.command, 'arm', self.arm)
            time.sleep(.02)
            stop = pool.submit(self.relay.command, 'stop')
            time.sleep(.02)
            release.set()
            idle.result()
            with self.assertRaises(RelayError):
                arm.result()
            self.assertFalse(stop.result()['armed'])
        self.assertFalse(self.mock.armed)


class CameraAuthenticationTests(unittest.TestCase):
    def test_automatic_token_only_on_exact_paired_endpoint_no_redirect(self):
        observed = []
        class Camera(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def do_GET(self):
                observed.append((self.path, self.headers.get('X-Control-Token')))
                if self.path == '/redirect':
                    self.send_response(302)
                    self.send_header('Location', '/stolen')
                    self.end_headers()
                    return
                payload = b'\xff\xd8test\xff\xd9'
                self.send_response(200)
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        camera = ThreadingHTTPServer(('127.0.0.1', 0), Camera)
        threading.Thread(target=camera.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{camera.server_port}'
        paired = [base + '/capture', TOKEN]
        video = VideoRelay()
        source = CameraSource(video, paired_resolver=lambda: tuple(paired), retry_seconds=.05)
        def wait_for(test):
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                if test():
                    return
                time.sleep(.02)
            self.fail('Camera condition not met')
        try:
            source.configure('', True)
            wait_for(lambda: bool(observed))
            self.assertEqual(observed[0], ('/capture', TOKEN))
            wait_for(lambda: video.sequence > 0)
            source.configure(base + '/manual', False)
            wait_for(lambda: any(path == '/manual' for path, _ in observed))
            self.assertTrue(all(token is None for path, token in observed if path == '/manual'))
            paired[0] = base + '/redirect'
            source.configure('', True)
            wait_for(lambda: any(path == '/redirect' for path, _ in observed))
            time.sleep(.15)
            self.assertFalse(any(path == '/stolen' for path, _ in observed))
            with self.assertRaises(VideoError):
                video.snapshot()
        finally:
            source.close()
            camera.shutdown()
            camera.server_close()


if __name__ == '__main__':
    unittest.main()
