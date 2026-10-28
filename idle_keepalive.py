"""Keep the local ESP connection checked without taking ownership or driving."""
import argparse
import datetime
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
STATUS_URL = 'http://127.0.0.1:8765/api/status'


def sample(http, url=STATUS_URL):
    """Only GET status. Never arm, stop, control, or refresh motor-command freshness."""
    try:
        with http.open(urllib.request.Request(url, method='GET'), timeout=.8) as response:
            state = json.load(response)
        return dict(connected=state.get('connected') is True, armed=state.get('armed') is True)
    except urllib.error.HTTPError as error:
        # A busy relay is allowed to prioritize the driver's requests.
        return dict(connected=None if error.code == 409 else False, error=f'HTTP {error.code}')
    except (OSError, ValueError, urllib.error.URLError):
        return dict(connected=False, error='Relay or ESP unavailable')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--count', type=int, help='Exit after this many checks; default runs until stopped')
    args = parser.parse_args()
    if args.count is not None and args.count < 1:
        parser.error('--count must be positive')
    folder = ROOT / 'artifacts'
    folder.mkdir(exist_ok=True)
    pid_path = folder / 'idle-keepalive.pid'
    state_path = folder / 'idle-keepalive.json'
    pid = os.getpid()
    pid_path.write_text(str(pid), encoding='ascii')
    http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    checked = successful = 0
    previous = None
    print('Idle keepalive running: GET localhost:8765/api/status every 1 second. No motor commands.', flush=True)
    try:
        while args.count is None or checked < args.count:
            started = time.monotonic()
            state = sample(http)
            checked += 1
            successful += state.get('connected') is True
            record = dict(pid=pid, at=datetime.datetime.now().isoformat(timespec='seconds'),
                          interval_seconds=1, checks=checked, successful=successful, **state)
            state_path.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
            signature = (state.get('connected'), state.get('error'))
            if signature != previous:
                print(json.dumps(record), flush=True)
                previous = signature
            if args.count is None or checked < args.count:
                time.sleep(max(0, 1 - (time.monotonic() - started)))
    except KeyboardInterrupt:
        pass
    finally:
        if pid_path.exists() and pid_path.read_text(encoding='ascii').strip() == str(pid):
            pid_path.unlink()


if __name__ == '__main__':
    main()
