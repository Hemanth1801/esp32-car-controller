import io
import json
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from video_relay import VideoRelay, VideoError
from camera_source import camera_url, mjpeg_frames, CameraSource
from server import Relay, make_server

JPEG = b'\xff\xd8test\xff\xd9'


class VideoTests(unittest.TestCase):
    def test_ownership_age_limits_and_no_replay(self):
        now = [10.]
        video = VideoRelay(lambda: now[0])
        session = video.start()['camera_session']
        with self.assertRaises(VideoError):
            video.start()
        with self.assertRaises(VideoError):
            video.publish('wrong', JPEG, 0)
        for data, age in ((b'bad', 0), (JPEG, 301), (JPEG, -1), (b'\xff\xd8' + b'x' * VideoRelay.MAX_FRAME + b'\xff\xd9', 0)):
            with self.assertRaises(VideoError):
                video.publish(session, data, age)
        video.publish(session, JPEG, 100)
        frame, first, age = video.snapshot()
        self.assertEqual((frame, age), (JPEG, 100))
        now[0] += .66
        with self.assertRaises(VideoError):
            video.snapshot()
        now[0] += 3
        newer = video.start()['camera_session']
        with self.assertRaises(VideoError):
            video.stop(session)
        with self.assertRaises(VideoError):
            video.publish(session, JPEG, 0)
        video.publish(newer, JPEG, 0)
        self.assertGreater(video.snapshot()[1], first)
        video.stop(newer)
        with self.assertRaises(VideoError):
            video.snapshot()

    def test_url_and_multipart_bounds(self):
        self.assertEqual(camera_url('http://192.168.1.20:81/stream'), 'http://192.168.1.20:81/stream')
        for url in ('https://192.168.1.20/', 'http://example.com/', 'rtsp://192.168.1.20/', 'http://8.8.8.8/', 'http://user:pass@192.168.1.20/', 'http://192.168.1.20:99999/', 'http://0.0.0.0/', 'http://224.0.0.1/', 'http://192.168.1.20/\nsecret'):
            with self.assertRaises(VideoError, msg=url):
                camera_url(url)
        part = b'\r\n--boundary\r\nContent-Type: image/jpeg\r\nContent-Length: 8\r\nX-Timestamp: 12.34\r\n\r\n' + JPEG
        frames = list(mjpeg_frames(io.BytesIO(part + part), threading.Event()))
        self.assertEqual(len(frames), 2)
        self.assertEqual(frames[0][0], JPEG)
        self.assertEqual(frames[0][2], b'12.34')
        for payload in (b'--b\r\nContent-Type: image/jpeg\r\n\r\n', part[:-2], b'--b\r\n' + b'x' * 4097):
            with self.assertRaises(VideoError):
                list(mjpeg_frames(io.BytesIO(payload), threading.Event()))

    def test_http_video_is_separate_from_motor_api_and_origin_guarded(self):
        relay = Relay()
        calls = []
        relay.command = lambda *args: calls.append(args) or {'armed': False}
        server = make_server(relay, 0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}'
        http = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def post(path, body=b'', headers=None):
            with http.open(urllib.request.Request(base + path, data=body, headers=headers or {})) as response:
                return json.load(response)

        try:
            for path in ('/quest', '/camera', '/quest.js', '/quest-renderer.js', '/quest-input.js'):
                with http.open(base + path) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn('xr-spatial-tracking=(self)', response.headers['Permissions-Policy'])
            token = post('/api/video/start')['camera_session']
            headers = {'X-Camera-Session': token, 'Content-Type': 'image/jpeg', 'X-Capture-Age-Ms': '0'}
            post('/api/video/frame', JPEG, headers)
            with http.open(base + '/api/video/frame') as response:
                self.assertEqual(response.read(), JPEG)
                self.assertEqual(response.headers['X-Frame-Sequence'], '1')
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
            for body, extra in ((b'bad', {}), (JPEG, {'X-Capture-Age-Ms': 'oops'}), (JPEG, {'Origin': 'https://evil.example'})):
                with self.assertRaises(urllib.error.HTTPError):
                    post('/api/video/frame', body, {**headers, **extra})
            self.assertEqual(calls, [], 'Camera failures never issue motor commands')
            post('/api/video/stop', headers={'X-Camera-Session': token})
            with self.assertRaises(urllib.error.HTTPError) as error:
                http.open(base + '/api/video/frame')
            self.assertEqual(error.exception.code, 503)
            with self.assertRaises(urllib.error.HTTPError):
                post('/api/video/source', json.dumps({'url': 'http://8.8.8.8/'}).encode())
        finally:
            server.shutdown()
            server.server_close()

    def test_ip_camera_snapshot_reader_and_redirect_block(self):
        class Camera(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                if self.path == '/redirect':
                    self.send_response(302)
                    self.send_header('Location', '/capture')
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Content-Length', str(len(JPEG)))
                self.end_headers()
                self.wfile.write(JPEG)
        camera = ThreadingHTTPServer(('127.0.0.1', 0), Camera)
        threading.Thread(target=camera.serve_forever, daemon=True).start()
        video = VideoRelay()
        source = CameraSource(video)
        base = f'http://127.0.0.1:{camera.server_port}'
        try:
            source.configure(base + '/capture')
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                try:
                    self.assertEqual(video.snapshot()[0], JPEG)
                    break
                except VideoError:
                    time.sleep(.02)
            else:
                self.fail(source.error or 'Camera did not publish')
            source.configure('')
            with self.assertRaises(VideoError):
                video.snapshot()
            source.configure(base + '/redirect')
            source.worker.join(2)
            self.assertTrue(source.error)
            with self.assertRaises(VideoError):
                video.snapshot()
        finally:
            source.close()
            camera.shutdown()
            camera.server_close()


if __name__ == '__main__':
    unittest.main()
