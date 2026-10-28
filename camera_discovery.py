"""Discover only this project's paired camera; no subnet scanning or motor traffic."""
import hashlib
import hmac
import json
import secrets
import socket
import time

from local_network import local_address

PORT = 8770
PREFIX = b'ESP-CAR-CAMERA/1 '


def signature(key, nonce, camera_id, host, port, path):
    message = f'{nonce}\n{camera_id}\n{host}\n{port}\n{path}'.encode('ascii')
    return hmac.new(key.encode('ascii'), message, hashlib.sha256).hexdigest()


def validate_reply(data, host, nonce, key, expected_id=''):
    try:
        local_address(host)
        reply = json.loads(data)
        camera_id = reply['id']
        if reply['nonce'] != nonce or not isinstance(camera_id, str) or len(camera_id) != 12 or any(char not in '0123456789abcdef' for char in camera_id):
            return None
        if expected_id and camera_id != expected_id:
            return None
        # A paired companion exposes exactly this stream, not arbitrary LAN URLs.
        if reply['port'] != 81 or reply['path'] != '/stream':
            return None
        expected = signature(key, nonce, camera_id, host, 81, '/stream')
        if not isinstance(reply['signature'], str) or not hmac.compare_digest(expected, reply['signature']):
            return None
        return {'url': f'http://{host}:81/stream', 'id': camera_id}
    except (KeyError, ValueError, TypeError, UnicodeError):
        return None


def discover_camera(key, bind, expected_id='', stopped=None, timeout=1):
    if not key or not bind:
        return None
    nonce = secrets.token_hex(16)
    deadline = time.monotonic() + timeout
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp:
        udp.bind((local_address(bind), 0))
        udp.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        udp.settimeout(.15)
        udp.sendto(PREFIX + nonce.encode('ascii'), ('255.255.255.255', PORT))
        while time.monotonic() < deadline and not (stopped and stopped.is_set()):
            try:
                data, (host, _) = udp.recvfrom(1024)
            except socket.timeout:
                continue
            found = validate_reply(data, host, nonce, key, expected_id)
            if found:
                return found
    return None
