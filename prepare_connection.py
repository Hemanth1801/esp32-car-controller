"""Find the paired ESP on the LAN using status requests only; never arm or drive."""
import json
import secrets
import socket
import time
from pathlib import Path

from local_network import computer_address, local_address
from server import Relay, RelayError

ROOT = Path(__file__).resolve().parent
DISCOVERY_PORT = 8769


def paired_status(config, host):
    try:
        local_address(host)
        state = Relay({**config, 'esp_host': host}).upstream('status')
        return state.get('network_mode') == 'wifi' and state.get('driver') == 'L298N'
    except (OSError, ValueError, RelayError):
        return False


def discover(config, timeout=2.5):
    cached = config['esp_host']
    if paired_status(config, cached):
        return cached
    try:
        host = socket.gethostbyname(config.get('esp_hostname', 'esp-car.local'))
        if host != cached and paired_status(config, host):
            return host
    except OSError:
        pass
    nonce = secrets.token_hex(16)
    expected = ('ESP-CAR/1 ' + nonce).encode('ascii')
    request = ('ESP-CAR-DISCOVER/1 ' + nonce).encode('ascii')
    checked = set()
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp:
        udp.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        # Windows may otherwise broadcast through a virtual/VMware adapter.
        udp.bind((computer_address(cached), 0))
        udp.settimeout(.2)
        deadline, send_at = time.monotonic() + timeout, 0
        while time.monotonic() < deadline:
            if time.monotonic() >= send_at:
                udp.sendto(request, ('255.255.255.255', DISCOVERY_PORT))
                send_at = time.monotonic() + .6
            try:
                data, (host, _) = udp.recvfrom(256)
            except socket.timeout:
                continue
            if data != expected or host in checked:
                continue
            checked.add(host)
            # Discovery is only a hint. The paired token authenticates the API.
            if paired_status(config, host):
                return host
    raise ValueError('Paired ESP not found. Connect ESP, computer and phone to the same 2.4 GHz Wi-Fi; check firmware and router client isolation.')


def main():
    path = ROOT / 'relay.local.json'
    config = json.loads(path.read_text(encoding='utf-8'))
    if config.get('network_mode') == 'wifi':
        host = discover(config)
        if host != config['esp_host']:
            config['esp_host'] = host
            path.write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
        print(f'Paired ESP found: {host}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        raise SystemExit(str(error)) from None
