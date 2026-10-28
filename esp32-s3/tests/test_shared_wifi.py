import json
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import configure_wifi
import local_network
import prepare_connection
from setup import cpp_string


class SharedWiFiTests(unittest.TestCase):
    def test_credentials_preserve_pairing_and_enabled_mode(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'firmware/car_controller').mkdir(parents=True)
            credentials = root / 'wifi.txt'
            credentials.write_text('Wifi - Example network\nPassword - test-secret-123\n', encoding='utf-8')
            token = 'a' * 64
            (root / 'relay.local.json').write_text(json.dumps(dict(esp_host='192.168.4.1', control_token=token, timeout_seconds=.15)))
            (root / 'firmware/car_controller/config.h').write_text('#define MOTOR_OUTPUT_ENABLED true\n#define STEERING_HOLD_ENABLED true\n#define COMMAND_TIMEOUT_ENABLED false\n')
            configure_wifi.configure(credentials, root)
            firmware = (root / 'firmware/car_controller/config.h').read_text()
            config = json.loads((root / 'relay.local.json').read_text())
            self.assertIn(cpp_string('Example network'), firmware)
            self.assertIn(cpp_string('test-secret-123'), firmware)
            self.assertIn(cpp_string(token), firmware)
            self.assertIn('#define MOTOR_OUTPUT_ENABLED true', firmware)
            self.assertIn('#define STEERING_HOLD_ENABLED true', firmware)
            self.assertIn('#define COMMAND_TIMEOUT_ENABLED false', firmware)
            self.assertNotIn('AP_PASSWORD', firmware)
            self.assertEqual(config['control_token'], token)
            self.assertEqual(config['network_mode'], 'wifi')
            self.assertEqual(config['timeout_seconds'], .15)
            self.assertNotIn('password', config)
            self.assertEqual(json.loads((root / 'wifi.local.json').read_text())['ssid'], 'Example network')

    def test_invalid_credential_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'wifi.txt'
            for text in ('SSID: x\nPassword: short', 'Password: valid-password', 'SSID: ' + 'x' * 33 + '\nPassword: valid-password'):
                path.write_text(text)
                with self.assertRaises(ValueError):
                    configure_wifi.read_credentials(path)

    def test_private_address_and_route_selection(self):
        for value in ('192.168.58.22', '10.12.0.5', '172.20.1.5'):
            self.assertEqual(local_network.local_address(value), value)
        for value in ('127.0.0.1', '169.254.1.1', '0.0.0.0', '8.8.8.8', '224.0.0.1', '::1', 'esp-car.local'):
            with self.assertRaises(ValueError):
                local_network.local_address(value)
        with patch.object(local_network.socket, 'socket') as constructor:
            route = constructor.return_value.__enter__.return_value
            route.getsockname.return_value = ('192.168.58.22', 12345)
            self.assertEqual(local_network.computer_address('192.168.58.99'), '192.168.58.22')
            route.connect.assert_called_once_with(('192.168.58.99', 80))
            route.send.assert_not_called()
            route.getsockname.return_value = ('192.168.58.99', 12345)
            with self.assertRaises(ValueError):
                local_network.computer_address('192.168.58.99')

    def test_cached_address_uses_authenticated_status_only(self):
        config = dict(esp_host='192.168.58.99', control_token='a' * 64)
        relay = MagicMock()
        relay.upstream.return_value = dict(network_mode='wifi', driver='L298N', board='esp32-s3-n16r8')
        with patch.object(prepare_connection, 'Relay', return_value=relay):
            self.assertEqual(prepare_connection.discover(config), config['esp_host'])
            relay.upstream.assert_called_once_with('status')
        relay.upstream.return_value = dict(network_mode='hotspot', driver='L298N')
        with patch.object(prepare_connection, 'Relay', return_value=relay):
            self.assertFalse(prepare_connection.paired_status(config, config['esp_host']))
            self.assertFalse(prepare_connection.paired_status(config, '8.8.8.8'))

    def test_udp_discovery_checks_nonce_and_authenticates_candidate(self):
        config = dict(esp_host='192.168.4.1')
        nonce = 'a' * 32
        with patch.object(prepare_connection, 'paired_status', side_effect=lambda _, host: host == '192.168.58.99') as status, \
             patch.object(prepare_connection.socket, 'gethostbyname', side_effect=socket.gaierror()), \
             patch.object(prepare_connection.socket, 'socket') as constructor, \
             patch.object(prepare_connection, 'computer_address', return_value='192.168.58.22'), \
             patch.object(prepare_connection.secrets, 'token_hex', return_value=nonce):
            udp = constructor.return_value.__enter__.return_value
            udp.recvfrom.side_effect = [
                (b'ESP-CAR/1 wrong-nonce', ('192.168.58.123', 8769)),
                (('ESP-CAR/1 ' + nonce).encode(), ('192.168.58.99', 8769)),
            ]
            self.assertEqual(prepare_connection.discover(config), '192.168.58.99')
            self.assertEqual(status.call_count, 2)
            udp.bind.assert_called_once_with(('192.168.58.22', 0))
            udp.sendto.assert_called_with(('ESP-CAR-DISCOVER/1 ' + nonce).encode(), ('255.255.255.255', 8769))


if __name__ == '__main__':
    unittest.main()
