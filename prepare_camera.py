"""Prepare a separate AI Thinker ESP32-CAM for automatic pairing; never upload."""
import json
import secrets
from pathlib import Path

from setup import cpp_string

ROOT = Path(__file__).resolve().parent


def prepare(root=ROOT):
    wifi = json.loads((root / 'wifi.local.json').read_text(encoding='utf-8'))
    if not isinstance(wifi.get('ssid'), str) or not wifi['ssid'] or not isinstance(wifi.get('password'), str):
        raise ValueError('Configure this project’s shared Wi-Fi first.')
    path = root / 'camera.local.json'
    settings = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    key = settings.setdefault('discovery_key', secrets.token_hex(32))
    if len(key) != 64 or any(char not in '0123456789abcdef' for char in key):
        raise ValueError('Existing camera pairing key is invalid; it was not replaced.')
    settings.setdefault('url', '')
    settings.setdefault('camera_id', '')
    settings.setdefault('auto_discover', not bool(settings['url']))
    firmware = root / 'firmware/car_camera'
    firmware.mkdir(parents=True, exist_ok=True)
    (firmware / 'config.h').write_text('#pragma once\n' + '\n'.join([
        '// Separate AI Thinker ESP32-CAM only. Never flash this sketch to the motor ESP.',
        f'#define CAMERA_WIFI_SSID {cpp_string(wifi["ssid"])}',
        f'#define CAMERA_WIFI_PASSWORD {cpp_string(wifi["password"])}',
        f'#define CAMERA_PAIR_KEY {cpp_string(key)}',
    ]) + '\n', encoding='utf-8')
    path.write_text(json.dumps(settings, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    try:
        prepare()
        print('Camera Wi-Fi and pairing prepared. AI Thinker ESP32-CAM firmware is ready to build; nothing was uploaded.')
    except (OSError, ValueError, KeyError) as error:
        raise SystemExit(str(error)) from None
