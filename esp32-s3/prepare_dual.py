"""Prepare separate local tokens/addresses without modifying the classic package."""
import json
from pathlib import Path
from prepare_connection import discover
from dual_board import paired_motor_status, paired_camera_status

ROOT = Path(__file__).resolve().parent


def prepare(root=ROOT):
    folder = root / '.dual'
    folder.mkdir(exist_ok=True)
    path = folder / 'relay.local.json'
    if path.exists():
        config = json.loads(path.read_text(encoding='utf-8'))
    else:
        config = json.loads((root.parent / 'relay.local.json').read_text(encoding='utf-8'))
        camera = json.loads((root / 'relay.local.json').read_text(encoding='utf-8'))
        config['camera_device'] = {**camera, 'camera_only_required': True}
    for role, target, checker in [('Motor ESP32', config, paired_motor_status),
                                  ('Camera S3', config['camera_device'], paired_camera_status)]:
        try:
            target['esp_host'] = discover(target, timeout=1.5, checker=checker)
            print(f"{role} paired: {target['esp_host']}")
        except (OSError, ValueError):
            print(f'{role} offline; settings retained and runtime discovery will retry.')
    path.write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
    camera_file = folder / 'camera.local.json'
    if not camera_file.exists():
        camera_file.write_text(json.dumps({'url': '', 'auto_discover': True}, indent=2) + '\n', encoding='utf-8')
    print('Two-board profile ready. Classic source/configuration unchanged.')
    return config


if __name__ == '__main__':
    prepare()
