"""Classic ESP32 motors + independently paired, camera-only ESP32-S3."""
import ipaddress
import json
import threading
import time
import urllib.error
import urllib.request
import http.client

from server import Relay
from relay_errors import RelayError
from camera_source import NoRedirect


class MotorRelay(Relay):
    # Existing classic firmware has GET status, not the S3 heartbeat endpoint.
    idle_action = 'status'
    # The classic board can be owned by the unchanged original app. Background
    # status is observational: never adopt or stop that app's armed session.
    stop_unowned_on_idle = False

    def __init__(self, config):
        super().__init__(config)
        self.motor_verified_base = None

    def validate_device(self, state):
        if (state.get('board') not in (None, 'esp32-classic') or
                state.get('driver') != 'L298N' or state.get('network_mode') != 'wifi'):
            raise RelayError('Wrong motor device: this profile requires the classic L298N ESP32.')
        self.motor_verified_base = self.base

    def upstream(self, action, data=None):
        if action in ('arm', 'control', 'stop') and self.motor_verified_base != self.base:
            # A mistaken S3 address must never receive a motor POST, even when
            # error recovery tries to issue Stop after a rejected arm.
            super().upstream('status')
        return super().upstream(action, data)

    def rediscover(self):
        from prepare_connection import discover
        with self.state_lock:
            if self.active or self.priority_commands:
                return
            ticket = self.epoch
        try:
            host = discover(dict(self.config), timeout=1, checker=paired_motor_status)
        except (OSError, ValueError):
            return
        with self.arbitration_lock:
            if not self.net_lock.acquire(blocking=False):
                return
            try:
                with self.state_lock:
                    if self.active or self.priority_commands or ticket != self.epoch:
                        return
                    self.config = {**self.config, 'esp_host': host}
                    self.base = f"http://{host}:{int(self.config.get('esp_port', 80))}"
            finally:
                self.net_lock.release()


def paired_motor_status(config, host):
    try:
        MotorRelay({**config, 'esp_host': host}).upstream('status')
        return True
    except (OSError, ValueError, RelayError):
        return False


class CameraPeer:
    """Camera credentials are used only for status, heartbeat and its stream."""
    def __init__(self, config):
        self.config = dict(config)
        address = ipaddress.IPv4Address(config['esp_host'])
        if not address.is_private or address.is_unspecified or address.is_multicast:
            raise ValueError('Camera host must be a private IPv4 address.')
        token = config.get('control_token', '')
        if len(token) < 24 or token.startswith('REPLACE_'):
            raise ValueError('Missing independent S3 camera token.')
        self.lock = threading.Lock()
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.state = {}
        self.received_at = 0
        self.connected = False
        self.error = 'Waiting for S3 camera-only firmware'
        self.stopped = threading.Event()
        self.worker = None

    def request(self, action='status'):
        if action not in ('status', 'heartbeat'):
            raise ValueError('A camera peer cannot send motor commands.')
        with self.lock:
            config = dict(self.config)
        url = f"http://{config['esp_host']}:{int(config.get('esp_port', 80))}/api/{action}"
        request = urllib.request.Request(url, data=b'{}' if action == 'heartbeat' else None,
            headers={'X-Control-Token': config['control_token'], 'Content-Type': 'application/json'},
            method='POST' if action == 'heartbeat' else 'GET')
        try:
            with self.http.open(request, timeout=.2) as response:
                payload = response.read(8193)
            if len(payload) > 8192:
                raise ValueError()
            state = json.loads(payload)
            if not isinstance(state, dict) or state.get('board') != 'esp32-s3-n16r8':
                raise RelayError('The camera device is not the paired ESP32-S3.')
            if config.get('camera_only_required', True) and (
                    state.get('device_role') != 'camera-only' or state.get('output_enabled') is not False):
                raise RelayError('Upload the camera-only S3 firmware before using two-board mode.')
            if state.get('armed') is not False:
                raise RelayError('Camera S3 must remain disarmed.')
            with self.lock:
                self.state = state
                self.received_at = time.monotonic()
                self.connected = True
                self.error = ''
            return state
        except RelayError as error:
            with self.lock:
                self.connected = False
                self.error = str(error)
            raise
        except (OSError, ValueError, urllib.error.URLError, http.client.HTTPException):
            with self.lock:
                self.connected = False
                self.error = 'S3 camera offline or pairing failed'
            raise RelayError('S3 camera offline or pairing failed; reconnecting automatically.') from None

    def snapshot(self):
        with self.lock:
            connected = self.connected and time.monotonic() - self.received_at < 2
            camera = self.state.get('camera', {})
            camera = dict(camera) if isinstance(camera, dict) else {}
            if not connected:
                camera.update(ready=False, message=self.error or 'S3 camera disconnected')
            return {'host': self.config['esp_host'], 'connected': connected,
                    'role': 'camera-only', 'camera': camera,
                    'heartbeat_age_ms': round((time.monotonic() - self.received_at) * 1000) if self.received_at else None,
                    'message': self.error}

    def endpoint(self):
        with self.lock:
            camera = self.state.get('camera', {})
            if (not self.connected or time.monotonic() - self.received_at >= 2 or
                    not isinstance(camera, dict) or camera.get('ready') is not True or
                    camera.get('port') != 81 or camera.get('path') != '/stream'):
                return None
            return (f"http://{self.config['esp_host']}:81/stream", self.config['control_token'])

    def rediscover(self):
        from prepare_connection import discover
        try:
            host = discover(dict(self.config), timeout=1, checker=paired_camera_status)
        except (OSError, ValueError):
            return
        with self.lock:
            self.config['esp_host'] = host

    def start(self):
        if not self.worker:
            self.worker = threading.Thread(target=self.run, name='dual-s3-camera-health', daemon=True)
            self.worker.start()

    def run(self):
        next_discovery = 0
        while not self.stopped.is_set():
            began = time.monotonic()
            try:
                self.request('heartbeat')
            except RelayError as error:
                with self.lock:
                    self.connected = False
                    self.error = str(error)
                if time.monotonic() >= next_discovery:
                    self.rediscover()
                    next_discovery = time.monotonic() + 5
                self.stopped.wait(1)
                continue
            self.stopped.wait(max(.001, .05 - (time.monotonic() - began)))

    def close(self):
        self.stopped.set()
        if self.worker:
            self.worker.join(timeout=4)


def paired_camera_status(config, host):
    try:
        CameraPeer({**config, 'esp_host': host}).request('status')
        return True
    except (OSError, ValueError, RelayError):
        return False


class DualRelay(MotorRelay):
    def __init__(self, config):
        camera = config['camera_device']
        if config['esp_host'] == camera['esp_host'] and config.get('esp_port', 80) == camera.get('esp_port', 80):
            raise ValueError('Motor ESP32 and camera S3 must be separate devices.')
        if config['control_token'] == camera['control_token']:
            raise ValueError('Use distinct motor and camera pairing tokens.')
        super().__init__({key: value for key, value in config.items() if key != 'camera_device'})
        self.camera_peer = CameraPeer(camera)

    def paired_camera(self):
        return self.camera_peer.endpoint()

    def profile_info(self):
        return {'control_profile': 'dual', 'controller_label': 'ESP32 MOTORS + ESP32-S3 CAMERA',
                'motor_host': self.config['esp_host'], 'camera_host': self.camera_peer.snapshot()['host']}

    def transport_state(self, state):
        state = super().transport_state(state)
        camera = self.camera_peer.snapshot()
        return {**state, 'control_profile': 'dual', 'controller_label': 'ESP32 MOTORS + ESP32-S3 CAMERA',
                'board': 'esp32-classic', 'traffic_mode': 'fresh-controls' if self.active else 'idle-status',
                'motor_device': {'host': self.config['esp_host'], 'connected': state.get('connected', False)},
                'camera_device': camera, 'camera': camera['camera']}

    def error_state(self, error):
        return self.transport_state(super().error_state(error))
