"""Idle transport liveness only. Never arm, repeat inputs or renew motor deadlines."""
import threading
import time
from relay_errors import RelayError


class IdleHeartbeat:
    def __init__(self, relay, interval=.05):
        self.relay = relay
        self.interval = interval
        self.stopped = threading.Event()
        self.worker = None

    def start(self):
        if not self.worker:
            self.worker = threading.Thread(target=self.run, name='s3-idle-heartbeat', daemon=True)
            self.worker.start()

    def close(self):
        self.stopped.set()
        if self.worker:
            self.worker.join(timeout=4)

    def run(self):
        next_discovery = 0
        while not self.stopped.is_set():
            began = time.monotonic()
            try:
                self.relay.heartbeat()
            except RelayError as error:
                with self.relay.state_lock:
                    self.relay.last_status_error = (str(error), error.code)
                    self.relay.next_status_probe = time.monotonic() + 1
                if time.monotonic() >= next_discovery and not self.stopped.is_set():
                    self.relay.rediscover()
                    next_discovery = time.monotonic() + 5
                self.stopped.wait(1)
                continue
            # No catch-up queue if a request or rediscovery took longer.
            self.stopped.wait(max(.001, self.interval - (time.monotonic() - began)))
