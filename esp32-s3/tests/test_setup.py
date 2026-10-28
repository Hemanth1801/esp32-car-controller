import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import setup


class SetupTests(unittest.TestCase):
    def test_independent_s3_pairing_defaults_and_no_secret_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'firmware/car_controller').mkdir(parents=True)
            (root / 'wifi.local.json').write_text(json.dumps(dict(ssid='Test network', password='test-password-123')))
            output = io.StringIO()
            with patch.object(setup, 'ROOT', root), contextlib.redirect_stdout(output):
                setup.main()
            relay = json.loads((root / 'relay.local.json').read_text())
            wifi = json.loads((root / 'wifi.local.json').read_text())
            firmware = (root / 'firmware/car_controller/config.h').read_text()
            self.assertIn(setup.cpp_string(relay['control_token']), firmware)
            self.assertIn(setup.cpp_string(wifi['ssid']), firmware)
            self.assertIn(setup.cpp_string(wifi['password']), firmware)
            self.assertEqual(relay['esp_hostname'], 'esp-car-s3.local')
            self.assertEqual(relay['board'], 'esp32-s3-n16r8')
            self.assertTrue(8 <= len(wifi['password']) <= 63)
            self.assertIn('#define MOTOR_OUTPUT_ENABLED true', firmware)
            self.assertIn('#define COMMAND_TIMEOUT_ENABLED false', firmware)
            self.assertNotIn(relay['control_token'], output.getvalue())
            self.assertNotIn(wifi['password'], output.getvalue())
            with patch.object(setup, 'ROOT', root), self.assertRaises(SystemExit):
                setup.main()
            self.assertEqual(relay, json.loads((root / 'relay.local.json').read_text()))


if __name__ == '__main__':
    unittest.main()
