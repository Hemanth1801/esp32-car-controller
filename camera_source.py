"""Optional local IP-camera JPEG/MJPEG reader. No motor locks or commands."""
import ipaddress
import http.client
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from video_relay import VideoError, VideoRelay
from camera_discovery import discover_camera


def camera_url(value):
    if not isinstance(value, str) or len(value) > 1024 or any(ord(char) < 33 for char in value):
        raise VideoError('Enter a local camera HTTP stream address.')
    try:
        parts = urllib.parse.urlsplit(value)
        address = ipaddress.IPv4Address(parts.hostname or '')
        if parts.scheme != 'http' or not address.is_private or address.is_unspecified or address.is_multicast or parts.username or parts.password or parts.fragment or not 1 <= (parts.port or 80) <= 65535:
            raise ValueError()
    except ValueError:
        raise VideoError('Use http:// followed by the camera’s private IPv4 address. RTSP, public addresses, redirects and embedded passwords are unsupported.') from None
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


def mjpeg_frames(response, stopped):
    """ESP CameraWebServer and compatible multipart streams with Content-Length."""
    while not stopped.is_set():
        # Scan the boundary/preamble with bounded lines and total size.
        for _ in range(24):
            if stopped.is_set():
                return
            line = response.readline(4097)
            if not line:
                return
            if len(line) > 4096:
                raise VideoError('Camera multipart headers are too large.')
            if line.startswith(b'--'):
                break
        else:
            raise VideoError('Unsupported MJPEG boundary.')
        headers = {}
        began = time.monotonic()
        for _ in range(16):
            if stopped.is_set():
                return
            line = response.readline(4097)
            if len(line) > 4096 or not line:
                raise VideoError('Invalid MJPEG part headers.')
            if line in (b'\r\n', b'\n'):
                break
            key, separator, value = line.partition(b':')
            if not separator:
                raise VideoError('Invalid MJPEG header.')
            headers[key.strip().lower()] = value.strip()
        else:
            raise VideoError('Too many MJPEG part headers.')
        try:
            length = int(headers.get(b'content-length', b'0'))
        except ValueError:
            length = 0
        if not 4 <= length <= VideoRelay.MAX_FRAME:
            raise VideoError('MJPEG needs Content-Length and JPEG frames below 192 KiB. Use a smaller camera resolution.')
        if headers.get(b'content-type', b'').lower() != b'image/jpeg':
            raise VideoError('MJPEG part is not image/jpeg.')
        payload = response.read(length)
        if len(payload) != length:
            raise VideoError('Incomplete MJPEG frame.')
        yield payload, round((time.monotonic() - began) * 1000), headers.get(b'x-timestamp')


class CameraSource:
    def __init__(self, video, config_file=None, discovery_key='', discovery_bind=None, camera_id='', discoverer=discover_camera, retry_seconds=2):
        self.video = video
        self.config_file = config_file
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.worker = None
        self.url = ''
        self.error = ''
        self.session = ''
        self.discovery_key = discovery_key
        self.discovery_bind = discovery_bind
        self.camera_id = camera_id
        self.auto_discover = False
        self.discoverer = discoverer
        self.retry_seconds = retry_seconds
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def status(self):
        return {'url': self.url, 'auto_discover': self.auto_discover, 'camera_id': self.camera_id, 'message': self.error or ('Reading local camera' if self.url else 'Waiting for paired ESP32-CAM' if self.auto_discover else 'No IP camera configured')}

    def save(self):
        if self.config_file:
            self.config_file.write_text(json.dumps({'url': self.url, 'auto_discover': self.auto_discover, 'discovery_key': self.discovery_key, 'camera_id': self.camera_id}, indent=2) + '\n', encoding='utf-8')

    def configure(self, value, auto_discover=False):
        value = camera_url(value) if value else ''
        if auto_discover and not self.discovery_key:
            raise VideoError('Run prepare-camera.cmd on this computer once to prepare the paired camera.')
        with self.lock:
            self.close()
            self.url = value
            self.auto_discover = bool(auto_discover)
            self.error = ''
            self.save()
            if value or self.auto_discover:
                self.stop_event = threading.Event()
                self.worker = threading.Thread(target=self.run, args=(value, self.stop_event), daemon=True)
                self.worker.start()
            return self.status()

    def close(self):
        self.stop_event.set()
        if self.worker:
            self.worker.join(timeout=1.2)
            if self.worker.is_alive():
                raise VideoError('Previous camera is still closing. Try again shortly.', 409)
        self.worker = None

    def run(self, url, stopped):
        while not stopped.is_set():
            token = ''
            try:
                if self.auto_discover:
                    self.error = 'Looking for paired ESP32-CAM on the shared Wi-Fi...'
                    found = self.discoverer(self.discovery_key, self.discovery_bind, self.camera_id, stopped)
                    if not found:
                        self.error = 'Waiting for paired ESP32-CAM. Power it on when ready; reconnect is automatic.'
                        stopped.wait(self.retry_seconds)
                        continue
                    url = camera_url(found['url'])
                    if stopped.is_set():
                        return
                    self.url, self.camera_id = url, found['id']
                    self.save()
                token = self.video.start()['camera_session']
                self.session = token
                self.read_camera(url, stopped, token)
            except VideoError as error:
                self.error = str(error) + ' Retrying automatically.'
            except (OSError, ValueError, urllib.error.URLError, http.client.HTTPException):
                self.error = 'Camera offline or stream interrupted. Waiting to reconnect automatically.'
            finally:
                if token:
                    try:
                        self.video.stop(token)
                    except VideoError:
                        pass
                self.session = ''
            stopped.wait(self.retry_seconds)

    def read_camera(self, url, stopped, token):
        previous_timestamp = None
        while not stopped.is_set():
            began = time.monotonic()
            request = urllib.request.Request(url, headers={'Accept': 'multipart/x-mixed-replace, image/jpeg', 'Cache-Control': 'no-cache'})
            with self.http.open(request, timeout=.5) as response:
                kind = response.headers.get_content_type()
                if kind == 'multipart/x-mixed-replace':
                    for payload, age, timestamp in mjpeg_frames(response, stopped):
                        if stopped.is_set():
                            return
                        if timestamp is not None and timestamp == previous_timestamp:
                            continue
                        previous_timestamp = timestamp
                        if age <= 300:
                            self.video.publish(token, payload, age)
                            self.error = ''
                    raise VideoError('Camera stream ended.')
                if kind != 'image/jpeg':
                    raise VideoError('This address is not JPEG/MJPEG. Use the stream address, not the camera setup page.')
                payload = response.read(VideoRelay.MAX_FRAME + 1)
                age = round((time.monotonic() - began) * 1000)
                timestamp = response.headers.get('X-Timestamp')
                if age <= 300 and (timestamp is None or timestamp != previous_timestamp):
                    self.video.publish(token, payload, age)
                    self.error = ''
                previous_timestamp = timestamp
            stopped.wait(max(0, .1 - (time.monotonic() - began)))
