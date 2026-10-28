"""Hardware check: reset COM7 and read startup without arming or sending drive commands."""
import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/serial-python'))
import serial

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', default='COM7')
args = parser.parse_args()

with serial.Serial(args.port, 115200, timeout=.1) as port:
    port.dtr = False
    # Match esptool's Windows workaround: reapply DTR after each RTS change.
    # https://github.com/espressif/esptool/blob/v5.3.1/esptool/reset.py
    port.rts = True
    port.dtr = port.dtr
    time.sleep(.15)
    port.rts = False
    port.dtr = port.dtr
    boot = bytearray()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        boot.extend(port.read(port.in_waiting or 1))
        if b'DRY RUN; motor output disabled' in boot or b'Motor mode; press Arm on the PC' in boot:
            break
    text = boot.decode('utf-8', errors='replace')
    (ROOT / 'artifacts/hotspot-boot.txt').write_text(text, encoding='utf-8')
    for line in text.splitlines():
        if any(word in line for word in ('Hotspot ready:', 'ESP address:', 'DRY RUN;', 'Motor mode;', 'Connect this computer', 'failed', 'invalid', 'Brownout')):
            print(line)
    expected = ('Hotspot ready: ESP-Car', 'ESP address: 192.168.4.1')
    if not all(line in text for line in expected):
        raise SystemExit('Boot verification incomplete. See artifacts/hotspot-boot.txt.')
    if not any(message in text for message in ('DRY RUN; motor output disabled', 'Motor mode; press Arm on the PC')):
        raise SystemExit('Motor mode not captured in startup log.')
    print('Hardware startup verified; no arm or drive commands were sent.')
