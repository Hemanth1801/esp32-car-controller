"""Generate independent S3 pairing without overwriting local configuration."""
import json
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def cpp_string(value):
    return '"' + ''.join(f'\\x{byte:02x}' for byte in value.encode('utf-8')) + '"'

def main():
    relay = ROOT / 'relay.local.json'
    firmware = ROOT / 'firmware/car_controller/config.h'
    if relay.exists() or firmware.exists():
        raise SystemExit('S3 configuration already exists; setup will not overwrite it.')
    wifi = json.loads((ROOT / 'wifi.local.json').read_text(encoding='utf-8'))
    if not 1 <= len(wifi['ssid'].encode()) <= 32 or not 8 <= len(wifi['password'].encode()) <= 63:
        raise SystemExit('Set valid Wi-Fi credentials in this package first.')
    token = secrets.token_hex(32)
    relay.write_text(json.dumps(dict(esp_host='192.168.1.250', esp_hostname='esp-car-s3.local',
        network_mode='wifi', board='esp32-s3-n16r8', control_token=token, timeout_seconds=.15), indent=2) + '\n', encoding='utf-8')
    firmware.parent.mkdir(parents=True, exist_ok=True)
    firmware.write_text('#pragma once\n' + '\n'.join([
        f'#define WIFI_SSID {cpp_string(wifi["ssid"])}',
        f'#define WIFI_PASSWORD {cpp_string(wifi["password"])}',
        '#define WIFI_HOSTNAME "esp-car-s3"', f'#define CONTROL_TOKEN {cpp_string(token)}',
        '#define MOTOR_OUTPUT_ENABLED true', '#define STEERING_HOLD_ENABLED true',
        '#define COMMAND_TIMEOUT_ENABLED false']) + '\n', encoding='utf-8')
    print('Created independent S3 pairing. Motors enabled after Arm; steering hold; command timeout OFF.')

if __name__ == '__main__':
    main()
