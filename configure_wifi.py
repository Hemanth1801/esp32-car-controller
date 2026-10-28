"""Switch the configured car to shared Wi-Fi without printing credentials."""
import argparse
import json
import re
from pathlib import Path

from setup import cpp_string

ROOT = Path(__file__).resolve().parent


def read_credentials(path):
    fields = {}
    for line in Path(path).read_text(encoding='utf-8-sig').splitlines():
        match = re.fullmatch(r'\s*(wifi(?:\s+name)?|ssid|password|pass|pwd)\s*[:=\-]\s*(.*?)\s*', line, re.I)
        if match:
            fields['ssid' if match[1].lower().startswith(('wifi', 'ssid')) else 'password'] = match[2]
    ssid, password = fields.get('ssid', ''), fields.get('password', '')
    if not 1 <= len(ssid.encode('utf-8')) <= 32 or not 8 <= len(password.encode('utf-8')) <= 63:
        raise ValueError('Expected WiFi/SSID and Password labels with a valid SSID and 8–63 byte password.')
    return ssid, password


def configure(path, root=ROOT):
    ssid, password = read_credentials(path)
    relay_path = root / 'relay.local.json'
    config_path = root / 'firmware/car_controller/config.h'
    relay = json.loads(relay_path.read_text(encoding='utf-8'))
    firmware = config_path.read_text(encoding='utf-8')
    enabled = bool(re.search(r'^#define\s+MOTOR_OUTPUT_ENABLED\s+true\s*$', firmware, re.M))
    hold = bool(re.search(r'^#define\s+STEERING_HOLD_ENABLED\s+true\s*$', firmware, re.M))
    timeout_enabled = not bool(re.search(r'^#define\s+COMMAND_TIMEOUT_ENABLED\s+false\s*$', firmware, re.M))
    token = relay['control_token']
    if len(token) < 24 or token.startswith('REPLACE_'):
        raise ValueError('Run setup.py first to generate a paired control token.')
    hostname = 'esp-car'
    config_path.write_text('#pragma once\n' + '\n'.join([
        f'#define WIFI_SSID {cpp_string(ssid)}',
        f'#define WIFI_PASSWORD {cpp_string(password)}',
        f'#define WIFI_HOSTNAME {cpp_string(hostname)}',
        f'#define CONTROL_TOKEN {cpp_string(token)}',
        f'#define MOTOR_OUTPUT_ENABLED {str(enabled).lower()}',
        f'#define STEERING_HOLD_ENABLED {str(hold).lower()}',
        f'#define COMMAND_TIMEOUT_ENABLED {str(timeout_enabled).lower()}',
    ]) + '\n', encoding='utf-8')
    relay.update(network_mode='wifi', esp_hostname=hostname + '.local')
    relay_path.write_text(json.dumps(relay, indent=2) + '\n', encoding='utf-8')
    (root / 'wifi.local.json').write_text(json.dumps(dict(ssid=ssid, password=password, hostname=hostname), indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('credentials', type=Path)
    args = parser.parse_args()
    try:
        configure(args.credentials)
    except (OSError, ValueError, KeyError):
        raise SystemExit('Wi-Fi configuration failed. Check the credential labels and existing paired local configuration.') from None
    print('Shared Wi-Fi configured. Token and motor mode preserved. Rebuild and upload the firmware next.')
