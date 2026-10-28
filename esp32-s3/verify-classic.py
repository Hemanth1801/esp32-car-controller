"""Check the original project against the pre-migration SHA-256 manifest."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
manifest = json.loads((ROOT / 'artifacts/classic-manifest.json').read_text(encoding='utf-8'))
changed = [name for name, digest in manifest.items()
           if not (ROOT.parent / name).is_file() or hashlib.sha256((ROOT.parent / name).read_bytes()).hexdigest() != digest]
if changed:
    raise SystemExit('Original files changed: ' + ', '.join(changed))
print(f'PASS: all {len(manifest)} recorded original files are unchanged.')
