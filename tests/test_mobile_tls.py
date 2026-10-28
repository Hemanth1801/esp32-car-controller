import json
import ssl
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prepare_mobile import create_certificates
from server import Relay, make_server
from mock_esp import MockESP, TOKEN, mock_server


class PhoneHTTPSTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.folder = Path(cls.temp.name)
        create_certificates(cls.folder, '127.0.0.1')

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_trusted_https_phone_routes_and_origin_rules(self):
        esp = mock_server(MockESP())
        threading.Thread(target=esp.serve_forever, daemon=True).start()
        relay = Relay(dict(esp_host='127.0.0.1', esp_port=esp.server_port, control_token=TOKEN))
        server = make_server(relay, 0, tls=(self.folder / 'server.crt', self.folder / 'server.key'))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'https://127.0.0.1:{server.server_port}'
        context = ssl.create_default_context(cafile=str(self.folder / 'ca.pem'))
        http = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context))
        try:
            for path in ('/', '/phone'):
                with http.open(base + path) as response:
                    self.assertIn(b'Hold to accelerate forward', response.read())
                    self.assertIn('accelerometer=(self)', response.headers['Permissions-Policy'])
            with http.open(base + '/api/status') as response:
                self.assertTrue(json.load(response)['connected'])
            for path in ('/.mobile/ca.key', '/server.key', '/relay.local.json', '/hotspot.local.json', '/wifi.local.json', '/wifi%20-%20Burugupally.txt'):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    http.open(base + path)
                self.assertEqual(error.exception.code, 404)
            with self.assertRaises(urllib.error.HTTPError) as error:
                http.open(urllib.request.Request(base + '/api/stop', data=b'{}', headers={'Origin': base.replace('https:', 'http:')}))
            self.assertEqual(error.exception.code, 403, 'HTTP origin must not control the HTTPS endpoint')
            with http.open(urllib.request.Request(base + '/api/stop', data=b'{}', headers={'Origin': base})) as response:
                self.assertFalse(json.load(response)['armed'])
        finally:
            server.shutdown()
            server.server_close()
            esp.shutdown()
            esp.server_close()

    def test_certificate_regeneration_preserves_phone_ca(self):
        before = (self.folder / 'phone-ca.crt').read_bytes()
        create_certificates(self.folder, '192.168.58.22')
        self.assertEqual(before, (self.folder / 'phone-ca.crt').read_bytes())
        self.assertEqual(json.loads((self.folder / 'settings.json').read_text())['address'], '192.168.58.22')


if __name__ == '__main__':
    unittest.main()
