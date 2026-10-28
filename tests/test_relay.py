import concurrent.futures
import json
import socket
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Relay, RelayError, make_server
from mock_esp import MockESP, TOKEN, mock_server


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.mock = MockESP()
        self.esp = mock_server(self.mock)
        threading.Thread(target=self.esp.serve_forever, daemon=True).start()
        self.config = dict(esp_host='127.0.0.1', esp_port=self.esp.server_port, control_token=TOKEN, timeout_seconds=.15)
        self.relay = Relay(self.config)
        self.arm = dict(owner='one', throttle=0, steering=0, neutral=True)

    def tearDown(self):
        self.esp.shutdown()
        self.esp.server_close()

    def control(self, state, seq=1, **changes):
        return {**self.arm, 'session': state['session'], 'seq': seq, **changes}

    def test_normal_control_and_stop(self):
        state = self.relay.command('arm', self.arm)
        self.assertTrue(state['armed'])
        state = self.relay.command('control', self.control(state, throttle=.3, steering=-.2))
        self.assertEqual(state['throttle'], .3)
        self.assertEqual(state['drive_output'], 0)  # Dry run never reports physical output.
        self.assertFalse(self.relay.command('stop')['armed'])

    def test_non_neutral_and_invalid_numbers_stop(self):
        for changes in ({'throttle': .5}, {'neutral': False}, {'throttle': float('nan')}, {'steering': True}, {'throttle': 1.1}):
            with self.assertRaises(RelayError):
                self.relay.command('arm', {**self.arm, **changes})
            self.assertFalse(self.mock.armed)

    def test_ownership_and_old_sequence_disarm(self):
        state = self.relay.command('arm', self.arm)
        with self.assertRaises(RelayError):
            self.relay.command('control', self.control(state, owner='other'))
        self.assertFalse(self.mock.armed)
        state = self.relay.command('arm', self.arm)
        self.relay.command('control', self.control(state, seq=3))
        with self.assertRaises(RelayError):
            self.relay.command('control', self.control(state, seq=2))
        self.assertFalse(self.mock.armed)

    def test_timeout_requires_new_session(self):
        old = self.relay.command('arm', self.arm)
        time.sleep(.41)
        with self.assertRaises(RelayError):
            self.relay.command('control', self.control(old))
        state = self.relay.command('arm', self.arm)
        self.assertNotEqual(old['session'], state['session'])
        with self.assertRaises(RelayError):
            self.relay.command('control', self.control(old))
        self.assertFalse(self.mock.armed)

    def test_stop_during_arm(self):
        self.mock.delay_arm = .08
        with concurrent.futures.ThreadPoolExecutor() as pool:
            arming = pool.submit(self.relay.command, 'arm', self.arm)
            self.assertTrue(self.mock.arm_received.wait(1))
            stopped = pool.submit(self.relay.command, 'stop')
            with self.assertRaises(RelayError):
                arming.result()
            self.assertFalse(stopped.result()['armed'])
        self.assertIsNone(self.relay.active)

    def test_unreachable_discards_session_and_never_replays(self):
        state = self.relay.command('arm', self.arm)
        self.esp.shutdown()
        self.esp.server_close()
        with self.assertRaises(RelayError):
            self.relay.command('control', self.control(state, throttle=.5))
        self.assertIsNone(self.relay.active)
        controls = [x for x in self.mock.requests if x[0] == 'control']
        self.assertEqual(controls, [])

    def test_http_static_and_origin_protection(self):
        server = make_server(self.relay, 0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}'
        http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            for path in ('/', '/controls', '/test', '/wiring', '/wiring.svg', '/mapping.js'):
                with http.open(base + path) as response:
                    self.assertEqual(response.status, 200, path)
            for path in ('/relay.local.json', '/../server.py', '/config.h'):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    http.open(base + path)
                self.assertEqual(error.exception.code, 404)
            for headers in ({'Origin': 'https://example.com'}, {'Host': 'evil.example'}, {'Sec-Fetch-Site': 'cross-site'}):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    http.open(urllib.request.Request(base + '/api/arm', data=json.dumps(self.arm).encode(), headers=headers))
                self.assertEqual(error.exception.code, 403)
            self.assertEqual(self.mock.requests, [])
        finally:
            server.shutdown()
            server.server_close()

    def test_unconfigured_page_can_open_without_hardware(self):
        with self.assertRaisesRegex(RelayError, 'Setup required'):
            Relay().command('status')

    def test_listener_cannot_be_shared_by_another_controller(self):
        server = make_server(self.relay, 0)
        try:
            with self.assertRaises(OSError):
                make_server(self.relay, server.server_port)
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as duplicate:
                duplicate.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                with self.assertRaises(OSError):
                    duplicate.bind(('127.0.0.1', server.server_port))
        finally:
            server.server_close()

    def test_idle_status_allows_slow_reply_and_coalesces_duplicate_readers(self):
        real_command = self.mock.command
        def delayed_status(action, data):
            if action == 'status':
                time.sleep(.2)  # Slower than the 150 ms drive timeout.
            return real_command(action, data)
        self.mock.command = delayed_status
        self.assertTrue(self.relay.command('status')['connected'])
        before = len(self.mock.requests)
        timestamp = self.relay.last_state_at
        self.assertTrue(self.relay.command('status')['connected'])
        self.assertEqual(len(self.mock.requests), before, 'Idle readers share the same recent check')
        self.assertEqual(self.relay.last_state_at, timestamp)

    def test_failed_idle_status_has_shared_backoff_without_stop(self):
        with patch.object(self.relay, 'upstream', side_effect=RelayError('Temporary timeout')) as upstream:
            for _ in range(5):
                with self.assertRaisesRegex(RelayError, 'Temporary timeout'):
                    self.relay.command('status')
            self.assertEqual(upstream.call_count, 1, 'Duplicate idle readers must not flood failed probes')
        self.assertIsNone(self.relay.active)
        self.assertEqual(self.mock.requests, [], 'Idle timeout must never send Stop or control')

    def test_active_status_and_drive_keep_the_strict_timeout(self):
        state = self.relay.command('arm', self.arm)
        self.relay.last_state_at = 0
        real_open = self.relay.http.open
        with patch.object(self.relay.http, 'open', wraps=real_open) as opened:
            self.relay.command('status')
            self.assertEqual(opened.call_args.kwargs['timeout'], .15)
            self.relay.command('control', self.control(state))
            self.assertEqual(opened.call_args.kwargs['timeout'], .15)
        self.relay.command('stop')

    def test_busy_control_is_discarded_without_queueing(self):
        state = self.relay.command('arm', self.arm)
        self.relay.net_lock.acquire()
        try:
            with self.assertRaisesRegex(RelayError, 'discarded'):
                self.relay.command('control', self.control(state, throttle=.8))
        finally:
            self.relay.net_lock.release()
        self.assertEqual([r for r in self.mock.requests if r[0] == 'control'], [])
        self.relay.command('stop')

    def test_desktop_status_does_not_contend_with_phone_drive(self):
        self.relay.command('arm', self.arm)
        before = len(self.mock.requests)
        timestamp = self.relay.last_state_at
        self.relay.net_lock.acquire()
        try:
            self.assertTrue(self.relay.command('status')['armed'])
        finally:
            self.relay.net_lock.release()
        self.assertEqual(len(self.mock.requests), before)
        self.assertEqual(self.relay.last_state_at, timestamp, 'Status reads cannot refresh drive freshness')
        self.relay.command('stop')

    def test_passive_status_error_does_not_stop_or_invalidate_owner(self):
        state = self.relay.command('arm', self.arm)
        active = self.relay.active
        before = len(self.mock.requests)
        # Force a cache miss without letting the simulated device expire.
        self.relay.last_state_at = 0
        real_upstream = self.relay.upstream
        def status_failure(action, data=None):
            if action == 'status':
                raise RelayError('Status temporarily unavailable')
            return real_upstream(action, data)
        with patch.object(self.relay, 'upstream', side_effect=status_failure):
            with self.assertRaisesRegex(RelayError, 'temporarily unavailable'):
                self.relay.command('status')
        self.assertEqual(self.relay.active, active)
        self.assertTrue(self.mock.armed)
        self.assertEqual(len(self.mock.requests), before, 'Read failure must not send Stop')
        self.assertTrue(self.relay.command('control', self.control(state))['armed'])
        self.relay.command('stop')

    def test_competing_arm_does_not_disarm_current_owner(self):
        state = self.relay.command('arm', self.arm)
        before = len(self.mock.requests)
        active = self.relay.active
        with self.assertRaisesRegex(RelayError, 'already armed'):
            self.relay.command('arm', {**self.arm, 'owner': 'other-tab'})
        self.assertEqual(self.relay.active, active)
        self.assertTrue(self.mock.armed)
        self.assertEqual(len(self.mock.requests), before)
        self.assertTrue(self.relay.command('control', self.control(state))['armed'])
        self.relay.command('stop')


if __name__ == '__main__':
    unittest.main()
