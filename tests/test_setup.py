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
    def test_configs_share_token_and_default_disabled_without_secret_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'firmware/car_controller').mkdir(parents=True)
            output = io.StringIO()
            with patch.object(setup, 'ROOT', root), contextlib.redirect_stdout(output):
                setup.main()
            relay = json.loads((root / 'relay.local.json').read_text())
            hotspot = json.loads((root / 'hotspot.local.json').read_text())
            firmware = (root / 'firmware/car_controller/config.h').read_text()
            self.assertIn(setup.cpp_string(relay['control_token']), firmware)
            self.assertIn(setup.cpp_string(hotspot['ssid']), firmware)
            self.assertIn(setup.cpp_string(hotspot['password']), firmware)
            self.assertEqual(relay['esp_host'], '192.168.4.1')
            self.assertEqual(hotspot['ssid'], 'ESP-Car')
            self.assertTrue(8 <= len(hotspot['password']) <= 63)
            self.assertIn('#define MOTOR_OUTPUT_ENABLED false', firmware)
            self.assertIn('#define COMMAND_TIMEOUT_ENABLED true', firmware)
            self.assertNotIn(relay['control_token'], output.getvalue())
            self.assertNotIn(hotspot['password'], output.getvalue())
            with patch.object(setup, 'ROOT', root), self.assertRaises(SystemExit):
                setup.main()
            self.assertEqual(relay, json.loads((root / 'relay.local.json').read_text()))


if __name__ == '__main__':
    unittest.main()
