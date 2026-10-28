"""Bounded, memory-only phone camera frames; completely separate from motor commands."""
import secrets
import threading
import time


class VideoError(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.code = code


class VideoRelay:
    MAX_FRAME = 192 * 1024
    FRESH_SECONDS = .75

    def __init__(self, now=time.monotonic):
        self.now = now
        self.lock = threading.Lock()
        self.session = ''
        self.last_publish = -float('inf')
        self.frame = b''
        self.sequence = 0
        self.captured = -float('inf')

    def start(self):
        with self.lock:
            if self.session and self.now() - self.last_publish < 3:
                raise VideoError('A camera is already publishing. Stop it first.', 409)
            self.session = secrets.token_urlsafe(32)
            self.last_publish = self.now()
            self.frame = b''
            self.captured = -float('inf')
            return {'camera_session': self.session}

    def publish(self, session, payload, age_ms):
        if not 4 <= len(payload) <= self.MAX_FRAME or not payload.startswith(b'\xff\xd8') or not payload.endswith(b'\xff\xd9'):
            raise VideoError('Expected a bounded JPEG frame.')
        if not 0 <= age_ms <= 300:
            raise VideoError('Camera capture was delayed; discard this frame.')
        with self.lock:
            self.authorize(session)
            self.frame = payload
            self.last_publish = self.now()
            self.captured = self.last_publish - age_ms / 1000
            self.sequence += 1
            return {'sequence': self.sequence}

    def authorize(self, session):
        if not self.session or not isinstance(session, str) or not secrets.compare_digest(self.session, session):
            raise VideoError('Camera session expired or does not match.', 403)

    def stop(self, session):
        with self.lock:
            self.authorize(session)
            self.session = ''
            self.frame = b''
            return {'camera': False}

    def snapshot(self):
        with self.lock:
            age = self.now() - self.captured
            if not self.frame or age > self.FRESH_SECONDS:
                raise VideoError('No fresh camera video. Power on the paired camera or use the phone camera at /camera.', 503)
            return self.frame, self.sequence, max(0, round(age * 1000))
