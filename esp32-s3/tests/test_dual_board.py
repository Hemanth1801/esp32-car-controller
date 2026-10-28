import json
import sys
import threading
import time
import unittest
import urllib.request
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dual_board import DualRelay, MotorRelay, CameraPeer
from relay_errors import RelayError
from server import make_server
from mock_esp import MockESP

MOTOR_TOKEN = 'mock-classic-motor-token-only-1234567890'
CAMERA_TOKEN = 'mock-s3-camera-token-only-0987654321'


def device_server(role):
    model = MockESP()
    state = model.state
    if role == 'motor':
        model.state = lambda: {**state(), 'board': 'esp32-classic'}
    else:
        model.state = lambda: dict(board='esp32-s3-n16r8', armed=False, output_enabled=False,
            device_role='camera-only', camera=dict(ready=True, port=81, path='/stream', sensor='OV3660'))
    calls = []
    token = MOTOR_TOKEN if role == 'motor' else CAMERA_TOKEN
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def dispatch(self):
            supplied = self.headers.get('X-Control-Token')
            calls.append((self.command, self.path, supplied))
            if supplied != token:
                code, result = 401, dict(error='Wrong role token')
            elif role == 'camera':
                if self.path not in ('/api/status', '/api/heartbeat'):
                    code, result = 409, dict(error='Motor command reached camera')
                else:
                    code, result = 200, model.state()
            elif self.path == '/api/heartbeat':
                code, result = 404, dict(error='Classic firmware has no heartbeat endpoint')
            else:
                data = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))) or b'{}')
                code, result = model.command(self.path.rsplit('/', 1)[1], data)
            body = json.dumps(result).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        do_GET = dispatch
        do_POST = dispatch
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, model, calls


class DualBoardTests(unittest.TestCase):
    def setUp(self):
        self.motor, self.model, self.motor_calls = device_server('motor')
        self.camera, self.camera_model, self.camera_calls = device_server('camera')
        self.config = dict(esp_host='127.0.0.1', esp_port=self.motor.server_port,
            control_token=MOTOR_TOKEN, timeout_seconds=.15, camera_device=dict(esp_host='127.0.0.1',
                esp_port=self.camera.server_port, control_token=CAMERA_TOKEN))
        self.relay = DualRelay(self.config)
        self.arm = dict(owner='test-driver', throttle=0, steering=0, neutral=True)

    def tearDown(self):
        self.relay.camera_peer.close()
        for server in (self.motor, self.camera):
            server.shutdown()
            server.server_close()

    def test_controls_only_reach_motor_board_with_motor_token(self):
        self.relay.camera_peer.request('heartbeat')
        state = self.relay.command('arm', self.arm)
        self.relay.command('control', {**self.arm, 'session': state['session'], 'seq': 1, 'throttle': .3})
        self.assertEqual(self.model.throttle, .3)
        self.relay.command('stop')
        self.assertFalse(self.model.armed)
        self.assertTrue(all(token == MOTOR_TOKEN for _, _, token in self.motor_calls))
        self.assertTrue(all(token == CAMERA_TOKEN for _, _, token in self.camera_calls))
        self.assertEqual([path for _, path, _ in self.camera_calls], ['/api/heartbeat'])
        for action in ('arm', 'control', 'stop'):
            with self.assertRaises(ValueError):
                self.relay.camera_peer.request(action)

    def test_idle_motor_status_does_not_require_new_classic_firmware(self):
        state = self.relay.heartbeat()
        self.assertEqual(state['traffic_mode'], 'idle-status')
        self.assertEqual(self.motor_calls[-1][:2], ('GET', '/api/status'))
        self.assertFalse(self.model.armed)

    def test_idle_dual_relay_does_not_stop_classic_app_driver(self):
        driver = MotorRelay({key: value for key, value in self.config.items() if key != 'camera_device'})
        state = driver.command('arm', self.arm)
        for seq in range(1, 4):
            before = len(self.motor_calls)
            observed = self.relay.heartbeat()
            self.assertTrue(observed['armed'], 'Idle camera app must not disarm the old driving app')
            self.assertIsNone(self.relay.active, 'Observed session must never be adopted')
            self.assertEqual(self.motor_calls[before:], [('GET', '/api/status', MOTOR_TOKEN)])
            state = driver.command('control', {**self.arm, 'session': state['session'], 'seq': seq, 'throttle': .2})
            self.assertTrue(state['armed'])
        driver.command('stop')

    def test_arm_conflict_does_not_stop_other_app_owner(self):
        driver = MotorRelay({key: value for key, value in self.config.items() if key != 'camera_device'})
        state = driver.command('arm', self.arm)
        before = len(self.motor_calls)
        with self.assertRaisesRegex(RelayError, 'another app'):
            self.relay.command('arm', {**self.arm, 'owner': 'second-app'})
        self.assertEqual(self.motor_calls[before:], [('GET', '/api/status', MOTOR_TOKEN)])
        self.assertTrue(self.model.armed)
        self.assertIsNone(self.relay.active)
        driver.command('control', {**self.arm, 'session': state['session'], 'seq': 1})
        driver.command('stop')

    def test_explicit_emergency_stop_can_stop_other_app_owner(self):
        driver = MotorRelay({key: value for key, value in self.config.items() if key != 'camera_device'})
        driver.command('arm', self.arm)
        self.relay.command('stop')
        self.assertFalse(self.model.armed)

    def test_camera_requires_motor_disabled_role_and_pins_exact_stream(self):
        self.relay.camera_peer.request()
        self.assertEqual(self.relay.paired_camera(), ('http://127.0.0.1:81/stream', CAMERA_TOKEN))
        original = self.camera_model.state
        self.camera_model.state = lambda: {**original(), 'device_role': 'car', 'output_enabled': True}
        with self.assertRaisesRegex(RelayError, 'camera-only'):
            self.relay.camera_peer.request()
        self.camera_model.state = lambda: {**original(), 'camera': dict(ready=True, port=81, path='/api/control')}
        self.relay.camera_peer.request()
        self.assertIsNone(self.relay.paired_camera())

    def test_wrong_motor_role_never_receives_a_motor_post(self):
        # Deliberately point motor configuration at camera with its valid token.
        wrong = MotorRelay(dict(esp_host='127.0.0.1', esp_port=self.camera.server_port, control_token=CAMERA_TOKEN))
        with self.assertRaises(RelayError):
            wrong.command('arm', self.arm)
        self.assertTrue(self.camera_calls)
        self.assertTrue(all(method == 'GET' for method, _, _ in self.camera_calls))

    def test_motor_failure_has_no_camera_fallback(self):
        self.relay.camera_peer.request()
        with patch.object(self.relay, 'upstream', side_effect=RelayError('Motor offline')):
            with self.assertRaises(RelayError):
                self.relay.command('arm', self.arm)
        self.assertEqual(self.camera_calls, [('GET', '/api/status', CAMERA_TOKEN)])
        snapshot = self.relay.error_state(RelayError('Motor offline'))
        self.assertFalse(snapshot['connected'])
        self.assertTrue(snapshot['camera_device']['connected'])
        self.assertEqual(snapshot['control_profile'], 'dual')

    def test_camera_heartbeat_cannot_change_motor_session_or_deadline(self):
        state = self.relay.command('arm', self.arm)
        original = self.model.updated, self.model.seq, self.model.session
        for _ in range(4):
            self.relay.camera_peer.request('heartbeat')
        self.assertEqual(original, (self.model.updated, self.model.seq, self.model.session))
        self.relay.command('stop')

    def test_shared_token_or_same_device_configuration_rejected(self):
        with self.assertRaises(ValueError):
            DualRelay({**self.config, 'camera_device': {**self.config['camera_device'], 'control_token': MOTOR_TOKEN}})
        with self.assertRaises(ValueError):
            DualRelay({**self.config, 'camera_device': {**self.config['camera_device'], 'esp_port': self.motor.server_port}})

    def test_profile_api_and_error_status_do_not_expose_tokens(self):
        server = make_server(self.relay, 0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with http.open(f'http://127.0.0.1:{server.server_port}/api/profile') as response:
                payload = response.read().decode()
            self.assertEqual(json.loads(payload)['control_profile'], 'dual')
            combined = payload + json.dumps(self.relay.error_state(RelayError('Offline')))
            self.assertNotIn(MOTOR_TOKEN, combined)
            self.assertNotIn(CAMERA_TOKEN, combined)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
