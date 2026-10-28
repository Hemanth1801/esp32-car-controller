"""Create ignored local configs. Never replaces existing files or prints secrets."""
import json
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def cpp_string(value):
    # Byte escapes preserve UTF-8 SSIDs/passwords and cannot become C++ source code.
    return '"' + ''.join(f'\\x{byte:02x}' for byte in value.encode('utf-8')) + '"'


def main():
    relay = ROOT / 'relay.local.json'
    firmware = ROOT / 'firmware/car_controller/config.h'
    hotspot = ROOT / 'hotspot.local.json'
    if relay.exists() or firmware.exists() or hotspot.exists():
        raise SystemExit('Local configuration already exists. Edit it directly; setup will not overwrite it.')
    host, ssid = '192.168.4.1', 'ESP-Car'
    password = secrets.token_urlsafe(12)
    token = secrets.token_hex(32)
    relay.write_text(json.dumps({'esp_host': host, 'control_token': token, 'timeout_seconds': .15}, indent=2) + '\n', encoding='utf-8')
    firmware.write_text('#pragma once\n' + '\n'.join([
        f'#define AP_SSID {cpp_string(ssid)}',
        f'#define AP_PASSWORD {cpp_string(password)}',
        f'#define CONTROL_TOKEN {cpp_string(token)}',
        '#define MOTOR_OUTPUT_ENABLED false',
        '#define STEERING_HOLD_ENABLED false',
        '#define COMMAND_TIMEOUT_ENABLED true',
    ]) + '\n', encoding='utf-8')
    hotspot.write_text(json.dumps({'ssid': ssid, 'password': password, 'esp_host': host}, indent=2) + '\n', encoding='utf-8')
    print('Created ESP-Car hotspot configuration. Password saved in hotspot.local.json. Motor output is disabled.')


if __name__ == '__main__':
    main()
