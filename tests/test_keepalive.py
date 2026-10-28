import sys
import threading
import time
import unittest
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from idle_keepalive import sample
from server import Relay, make_server
from mock_esp import MockESP, TOKEN, mock_server


class KeepaliveTests(unittest.TestCase):
    def test_status_only_preserves_owner_and_does_not_extend_motor_watchdog(self):
        mock = MockESP()
        esp = mock_server(mock)
        threading.Thread(target=esp.serve_forever, daemon=True).start()
        relay = Relay(dict(esp_host='127.0.0.1', esp_port=esp.server_port,
                           control_token=TOKEN, timeout_seconds=.15))
        server = make_server(relay, 0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f'http://127.0.0.1:{server.server_port}/api/status'
        http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            for _ in range(3):
                self.assertEqual(sample(http, url), dict(connected=True, armed=False))
            self.assertTrue(all(action == 'status' for action, _, _ in mock.requests))
            state = relay.command('arm', dict(owner='wheel', throttle=0, steering=0, neutral=True))
            owner = relay.active
            updated = mock.updated
            self.assertEqual(sample(http, url), dict(connected=True, armed=True))
            self.assertEqual(relay.active, owner)
            self.assertEqual(mock.updated, updated, 'Keepalive must not extend the motor watchdog')
            self.assertEqual(mock.session, state['session'])
            time.sleep(.41)
            self.assertEqual(sample(http, url), dict(connected=True, armed=False))
            self.assertFalse(mock.armed)
            self.assertTrue(all(action in ('status', 'arm') for action, _, _ in mock.requests),
                            'The helper must not send motor controls or Stop')
        finally:
            server.shutdown()
            server.server_close()
            esp.shutdown()
            esp.server_close()


if __name__ == '__main__':
    unittest.main()
