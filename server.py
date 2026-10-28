"""Local UI and command relay, with optional HTTPS phone access on shared Wi-Fi."""
import argparse
import ipaddress
import http.client
import json
import math
import socket
import ssl
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from local_network import local_address, computer_address
from video_relay import VideoRelay, VideoError
from camera_source import CameraSource

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
PORT = 8765


class RelayError(Exception):
    def __init__(self, message, code=503):
        super().__init__(message)
        self.code = code


class ExclusiveHTTPServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR permits competing listeners with separate owners.
    # Reserve each controller port exclusively, including the phone listeners.
    allow_reuse_address = not hasattr(socket, 'SO_EXCLUSIVEADDRUSE')
    allow_reuse_port = False

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Relay:
    def __init__(self, config=None):
        self.config = config
        self.video = VideoRelay()
        self.camera_source = CameraSource(self.video)
        self.net_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.epoch = 0
        self.active = None
        self.last_state = None
        self.last_state_at = 0
        self.last_status_error = None
        self.next_status_probe = 0
        # A configured local ESP must never be sent through a system HTTP proxy.
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        if config:
            address = ipaddress.IPv4Address(config['esp_host'])
            if not address.is_private or address.is_unspecified or address.is_multicast:
                raise ValueError('esp_host must be a private IPv4 address.')
            if len(config.get('control_token', '')) < 24 or config['control_token'].startswith('REPLACE_'):
                raise ValueError('Configure the same random control token in relay.local.json and config.h.')
            self.timeout = float(config.get('timeout_seconds', .15))
            if not math.isfinite(self.timeout) or not .05 <= self.timeout <= .2:
                raise ValueError('timeout_seconds must be between 0.05 and 0.2.')
            self.base = f"http://{address}:{int(config.get('esp_port', 80))}"

    def invalidate(self):
        with self.state_lock:
            self.epoch += 1
            self.active = None

    def upstream(self, action, data=None):
        if not self.config:
            raise RelayError('Setup required: run python setup.py to create paired ESP settings, then restart the relay.')
        request = urllib.request.Request(
            self.base + '/api/' + action,
            data=None if data is None else json.dumps(data, allow_nan=False).encode(),
            headers={'X-Control-Token': self.config['control_token'], 'Content-Type': 'application/json'},
            method='GET' if data is None else 'POST',
        )
        try:
            with self.state_lock:
                # Idle health checks can tolerate a delayed reply. Drive commands
                # and any reads while an owner is armed retain the strict timeout.
                timeout = .5 if action == 'status' and self.active is None else self.timeout
            with self.http.open(request, timeout=timeout) as response:
                body = response.read(8193)
                if len(body) > 8192:
                    raise RelayError('ESP response too large.')
                state = json.loads(body)
                if not isinstance(state, dict) or not isinstance(state.get('armed'), bool):
                    raise RelayError('Invalid ESP status response.')
                result = {**state, 'connected': True}
                with self.state_lock:
                    self.last_state = result
                    self.last_state_at = time.monotonic()
                    self.last_status_error = None
                    self.next_status_probe = 0
                return result
        except urllib.error.HTTPError as error:
            # Do not include upstream response bodies or credentials in logs/errors.
            raise RelayError(f'ESP rejected {action} ({error.code}); stopped or disarmed.', 409 if error.code == 409 else 502) from None
        except (OSError, ValueError, urllib.error.URLError, socket.timeout, http.client.HTTPException):
            raise RelayError('ESP unreachable or response invalid; disarmed. Check shared Wi-Fi, pairing token, and restart the launcher to rediscover the ESP.') from None

    @staticmethod
    def validate_owner(data):
        owner = data.get('owner')
        if not isinstance(owner, str) or not 1 <= len(owner) <= 100:
            raise RelayError('Missing controller ID.', 400)
        return owner

    @staticmethod
    def inputs(data):
        values = [data.get(k) for k in ('throttle', 'steering')]
        if any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 1 for v in values):
            raise RelayError('Invalid input; stopped.', 400)
        return values

    def command(self, action, data=None):
        data = data or {}
        # A desktop status tab must not contend with the phone's drive requests.
        # This is a read-only snapshot, never a command heartbeat or replay.
        if action == 'status':
            with self.state_lock:
                now = time.monotonic()
                if self.last_state and now - self.last_state_at < (.4 if self.active else .5):
                    return dict(self.last_state)
                if self.last_status_error and now < self.next_status_probe:
                    raise RelayError(*self.last_status_error)
        if action == 'stop':
            # Invalidate before waiting for an in-flight arm/control request.
            self.invalidate()
            with self.net_lock:
                return self.upstream('stop', {})
        if action == 'arm':
            with self.state_lock:
                if self.active:
                    raise RelayError('Another controller is already armed. Waiting for it to stop.', 409)
        with self.state_lock:
            ticket = self.epoch
        if not self.net_lock.acquire(blocking=False):
            raise RelayError('Relay busy; this command was discarded.', 409)
        try:
            if action == 'status':
                state = self.upstream('status')
                if not state['armed']:
                    with self.state_lock:
                        self.active = None
                return state
            owner = self.validate_owner(data)
            throttle, steering = self.inputs(data)
            with self.state_lock:
                if ticket != self.epoch:
                    raise RelayError('Command cancelled by stop.', 409)
                active = self.active
            if action == 'arm':
                if abs(throttle) > .05 or abs(steering) > .05 or data.get('neutral') is not True:
                    raise RelayError('Release pedals and centre steering before arming.', 400)
                if active:
                    raise RelayError('A controller is already armed. Stop before re-arming.', 409)
                state = self.upstream('status')
                with self.state_lock:
                    if ticket != self.epoch:
                        raise RelayError('Arm cancelled by stop.', 409)
                state = self.upstream('arm', {**data, 'arm_nonce': state['arm_nonce']})
                if not state.get('armed') or not isinstance(state.get('session'), str):
                    raise RelayError('ESP did not acknowledge arming.')
                with self.state_lock:
                    cancelled = ticket != self.epoch
                    if not cancelled:
                        self.active = (owner, state['session'])
                if cancelled:
                    self.upstream('stop', {})
                    raise RelayError('Arm cancelled by stop.', 409)
                return state
            if action != 'control':
                raise RelayError('Unknown action.', 404)
            if active != (owner, data.get('session')):
                raise RelayError('Session expired; press Arm to resume.', 409)
            if type(data.get('seq')) is not int or not 1 <= data['seq'] <= 4294967295:
                raise RelayError('Invalid sequence number.', 400)
            state = self.upstream('control', data)
            with self.state_lock:
                cancelled = ticket != self.epoch
            if cancelled:
                raise RelayError('Control cancelled by stop.', 409)
            if not state['armed']:
                self.invalidate()
            return state
        except (RelayError, KeyError) as error:
            # A read-only observer cannot cancel another controller's session.
            # The owning control stream and the ESP watchdog enforce freshness.
            if action == 'status':
                with self.state_lock:
                    # Several tabs plus an idle keepalive must not flood an ESP
                    # that is already unreachable. This never refreshes commands.
                    self.last_status_error = (str(error), getattr(error, 'code', 503))
                    self.next_status_probe = time.monotonic() + 1
                raise
            # Rejected or failed requests never leave a local session resumable.
            self.invalidate()
            try:
                self.upstream('stop', {})
            except RelayError:
                pass
            if isinstance(error, KeyError):
                raise RelayError('Incompatible ESP firmware; missing arm nonce.') from None
            raise
        finally:
            self.net_lock.release()


def handler_for(relay):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Never log request bodies or pairing tokens.

        def reply(self, status, body, content_type='application/json; charset=utf-8', headers=None):
            payload = json.dumps(body, allow_nan=False).encode() if isinstance(body, dict) else body
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Permissions-Policy', 'accelerometer=(self), gyroscope=(self), magnetometer=(), camera=(self), microphone=(), xr-spatial-tracking=(self)')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
            for key, value in (headers or {}).items():
                self.send_header(key, str(value))
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def local_request(self):
            allowed = self.server.allowed_hosts
            if self.headers.get('Host', '').lower() not in allowed:
                self.reply(403, {'error': 'This server address is not allowed.'})
                return False
            origin = self.headers.get('Origin')
            if origin and origin not in {f'{self.server.scheme}://{host}' for host in allowed}:
                self.reply(403, {'error': 'Cross-origin control is forbidden.'})
                return False
            if self.headers.get('Sec-Fetch-Site') == 'cross-site':
                self.reply(403, {'error': 'Cross-site requests are forbidden.'})
                return False
            return True

        def do_GET(self):
            if not self.local_request():
                return
            if self.path == '/api/video/frame':
                try:
                    payload, sequence, age = relay.video.snapshot()
                    self.reply(200, payload, 'image/jpeg', {'X-Frame-Sequence': sequence, 'X-Frame-Age-Ms': age})
                except VideoError as error:
                    self.reply(error.code, {'error': str(error)})
                return
            if self.path == '/api/video/source':
                self.reply(200, relay.camera_source.status())
                return
            if self.path == '/api/status':
                try:
                    self.reply(200, relay.command('status'))
                except RelayError as error:
                    self.reply(error.code, {'error': str(error), 'armed': False, 'connected': False})
                return
            route = {'/': 'phone.html' if self.server.mobile else 'index.html', '/phone': 'phone.html', '/controls': 'index.html', '/test': 'tester.html', '/wiring': 'wiring.html', '/quest': 'quest.html', '/camera': 'camera.html'}
            name = route.get(self.path, self.path.removeprefix('/'))
            file = WEB / name
            types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'}
            if '/' in name or '\\' in name or file.suffix not in types or not file.is_file():
                self.reply(404, {'error': 'Not found.'})
                return
            self.reply(200, file.read_bytes(), types[file.suffix])

        def do_POST(self):
            if not self.local_request():
                return
            if self.path.startswith('/api/video/'):
                self.video_post()
                return
            if self.path not in ('/api/arm', '/api/control', '/api/stop'):
                self.reply(404, {'error': 'Unknown action.'})
                return
            try:
                self.connection.settimeout(.3)
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 <= length <= 2048:
                    raise ValueError()
                data = json.loads(self.rfile.read(length) or b'{}')
                if not isinstance(data, dict):
                    raise ValueError()
            except (ValueError, OSError):
                try:
                    relay.command('stop')
                except RelayError:
                    pass
                self.reply(400, {'error': 'Invalid request; stopped.', 'armed': False})
                return
            try:
                self.reply(200, relay.command(self.path.rsplit('/', 1)[1], data))
            except RelayError as error:
                self.reply(error.code, {'error': str(error), 'armed': False})

        def video_post(self):
            # Invalid camera traffic must never arm, stop, or contend with motors.
            try:
                if self.path not in ('/api/video/start', '/api/video/frame', '/api/video/stop', '/api/video/source'):
                    self.reply(404, {'error': 'Unknown video action.'})
                    return
                self.connection.settimeout(.5)
                length = int(self.headers.get('Content-Length', '0'))
                maximum = VideoRelay.MAX_FRAME if self.path.endswith('/frame') else 2048 if self.path.endswith('/source') else 0
                if not 0 <= length <= maximum:
                    raise VideoError('Invalid camera request size.')
                session = self.headers.get('X-Camera-Session', '')
                if self.path.endswith('/source'):
                    data = json.loads(self.rfile.read(length))
                    if not isinstance(data, dict) or not isinstance(data.get('url'), str):
                        raise VideoError('Expected a camera address.')
                    automatic = data.get('auto_discover', False)
                    if not isinstance(automatic, bool):
                        raise VideoError('Expected a camera discovery setting.')
                    result = relay.camera_source.configure(data['url'], automatic)
                elif self.path.endswith('/start'):
                    result = relay.video.start()
                elif self.path.endswith('/stop'):
                    result = relay.video.stop(session)
                else:
                    if self.headers.get('Content-Type') != 'image/jpeg':
                        raise VideoError('Expected image/jpeg.')
                    age = int(self.headers.get('X-Capture-Age-Ms', '-1'))
                    result = relay.video.publish(session, self.rfile.read(length), age)
                self.reply(200, result)
            except VideoError as error:
                self.reply(error.code, {'error': str(error)})
            except (ValueError, OSError):
                self.reply(400, {'error': 'Incomplete or invalid camera request.'})
    return Handler


def make_server(relay, port=PORT, bind='127.0.0.1', tls=None):
    server = ExclusiveHTTPServer((bind, port), handler_for(relay))
    server.mobile = tls is not None
    server.scheme = 'https' if tls else 'http'
    server.allowed_hosts = {f'{bind}:{server.server_port}'}
    if bind == '127.0.0.1':
        server.allowed_hosts.add(f'localhost:{server.server_port}')
    if tls:
        try:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.load_cert_chain(str(tls[0]), str(tls[1]))
            server.socket = context.wrap_socket(server.socket, server_side=True)
        except (OSError, ssl.SSLError):
            server.server_close()
            raise
    return server


def make_certificate_server(address, port=8768):
    class CertificateHandler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            # Serve only the public certificate and setup instructions, never keys or API.
            if self.path == '/phone-ca.crt':
                payload = (ROOT / '.mobile/phone-ca.crt').read_bytes()
                kind = 'application/x-x509-ca-cert'
            elif self.path == '/':
                payload = (WEB / 'phone-setup.html').read_text(encoding='utf-8').replace('PHONE_ADDRESS', address).encode()
                kind = 'text/html; charset=utf-8'
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(payload)
    return ExclusiveHTTPServer((address, port), CertificateHandler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mobile-address', help='Computer private IPv4 address on the shared Wi-Fi')
    args = parser.parse_args()
    config_file = ROOT / 'relay.local.json'
    try:
        relay = Relay(json.loads(config_file.read_text(encoding='utf-8')) if config_file.exists() else None)
    except (ValueError, KeyError) as error:
        raise SystemExit(f'Invalid relay.local.json: {error}') from None
    try:
        server = make_server(relay)
    except OSError:
        raise SystemExit('Cannot start localhost:8765. Close any existing controller server window, then try again.') from None
    extra_servers = []
    camera_file = ROOT / 'camera.local.json'
    relay.camera_source = CameraSource(relay.video, camera_file)
    if camera_file.exists():
        try:
            camera_settings = json.loads(camera_file.read_text(encoding='utf-8'))
            discovery_key = camera_settings.get('discovery_key', '')
            if discovery_key and (len(discovery_key) != 64 or any(char not in '0123456789abcdef' for char in discovery_key)):
                raise ValueError('Invalid camera pairing')
            camera_bind = args.mobile_address or (computer_address(relay.config['esp_host']) if discovery_key and relay.config else None)
            relay.camera_source = CameraSource(relay.video, camera_file, discovery_key, camera_bind, camera_settings.get('camera_id', ''))
            relay.camera_source.configure(camera_settings['url'], camera_settings.get('auto_discover', False))
        except (OSError, ValueError, KeyError, VideoError):
            print('Camera configuration invalid; video disabled. Configure it from /quest.', flush=True)
    if args.mobile_address:
        try:
            address = local_address(args.mobile_address)
        except ValueError as error:
            server.server_close()
            raise SystemExit(str(error)) from None
        if relay.config and address == relay.config['esp_host']:
            server.server_close()
            raise SystemExit('Mobile address must belong to this computer, not the ESP.')
        folder = ROOT / '.mobile'
        try:
            extra_servers.append(make_server(relay, 8767, str(address), (folder / 'server.crt', folder / 'server.key')))
            extra_servers.append(make_certificate_server(str(address)))
        except (OSError, ssl.SSLError):
            server.server_close()
            for extra in extra_servers:
                extra.server_close()
            raise SystemExit('Phone HTTPS setup failed. Join the shared Wi-Fi and run start-mobile.cmd to prepare certificates.') from None
        for extra in extra_servers:
            threading.Thread(target=extra.serve_forever, daemon=True).start()
        print(f'Phone setup: http://{address}:8768', flush=True)
        print(f'Phone controls: https://{address}:8767/phone', flush=True)
        print(f'Quest cockpit: https://{address}:8767/quest', flush=True)
    print(f'Local car controller: http://localhost:{PORT}', flush=True)
    print('No configuration yet. Run python setup.py.' if not relay.config else 'Relay ready. Keep ESP, computer and phone on the same Wi-Fi.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            relay.command('stop')
        except RelayError:
            pass
        try:
            relay.camera_source.close()
        except VideoError:
            pass
        server.server_close()
        for extra in extra_servers:
            extra.shutdown()
            extra.server_close()


if __name__ == '__main__':
    main()
