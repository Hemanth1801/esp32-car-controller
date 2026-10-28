"""Protocol simulator for integration/browser tests; never connected to hardware."""
import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = 'test-only-not-a-real-device-token-1234'


class MockESP:
    def __init__(self):
        self.lock = threading.Lock()
        self.armed = False
        self.owner = self.session = ''
        self.nonce = secrets.token_hex(8)
        self.seq = 0
        self.throttle = self.steering = 0
        self.updated = time.monotonic()
        self.delay_arm = 0
        self.arm_received = threading.Event()
        self.requests = []

    def stop(self):
        self.armed = False
        self.throttle = self.steering = 0
        self.nonce = secrets.token_hex(8)

    def state(self):
        if self.armed and time.monotonic() - self.updated >= .4:
            self.stop()
        return dict(board='esp32-s3-n16r8', network_mode='wifi', driver='L298N', armed=self.armed, session=self.session if self.armed else '', arm_nonce=self.nonce,
                    throttle=self.throttle, steering=self.steering, drive_output=0, steering_output=0,
                    output_enabled=False, mode='dry-run', message='MOCK ESP · DRY RUN · motor output disabled')

    def command(self, action, data):
        if action == 'arm':
            self.arm_received.set()
            time.sleep(self.delay_arm)
        with self.lock:
            self.requests.append((action, data, time.monotonic()))
            self.state()
            if action == 'stop':
                self.stop()
            elif action == 'arm':
                if self.armed or data.get('arm_nonce') != self.nonce or not data.get('neutral'):
                    return 409, {'error': 'Arm rejected'}
                self.armed = True
                self.owner = data['owner']
                self.session = secrets.token_hex(16)
                self.nonce = secrets.token_hex(8)
                self.seq = 0
                self.updated = time.monotonic()
            elif action == 'control':
                if not self.armed or self.owner != data.get('owner') or self.session != data.get('session') or data.get('seq', 0) <= self.seq:
                    self.stop()
                    return 409, {'error': 'Session or sequence rejected'}
                self.throttle, self.steering = data['throttle'], data['steering']
                self.seq = data['seq']
                self.updated = time.monotonic()
            return 200, self.state()


def mock_server(mock):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def handle_request(self, data):
            if self.headers.get('X-Control-Token') != TOKEN:
                code, state = 401, {'error': 'Invalid token'}
            else:
                code, state = mock.command(self.path.rsplit('/', 1)[1], data)
            payload = json.dumps(state).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def do_GET(self):
            self.handle_request({})

        def do_POST(self):
            self.handle_request(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
    return ThreadingHTTPServer(('127.0.0.1', 0), Handler)
