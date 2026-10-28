"""Exercise server.py as __main__, including idle failure and recovery."""
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mock_esp import MockESP, TOKEN, mock_server


class MainEntrypointTests(unittest.TestCase):
    def test_idle_worker_survives_failure_and_recovers_when_run_as_script(self):
        mock = MockESP()
        online = [False]
        command = mock.command
        def offline_then_online(action, data):
            if action == 'heartbeat' and not online[0]:
                with mock.lock:
                    mock.requests.append((action, data, time.monotonic()))
                return 503, {'error': 'Simulated offline'}
            return command(action, data)
        mock.command = offline_then_online
        esp = mock_server(mock)
        threading.Thread(target=esp.serve_forever, daemon=True).start()
        root = Path(__file__).resolve().parents[1]
        try:
            with tempfile.TemporaryDirectory() as directory:
                folder = Path(directory)
                for source in root.glob('*.py'):
                    shutil.copy2(source, folder / source.name)
                with socket.socket() as port:
                    port.bind(('127.0.0.1', 0))
                    listener = port.getsockname()[1]
                source = (folder / 'server.py').read_text(encoding='utf-8')
                (folder / 'server.py').write_text(source.replace('PORT = 8865', f'PORT = {listener}'), encoding='utf-8')
                (folder / 'relay.local.json').write_text(json.dumps(dict(esp_host='127.0.0.1', esp_port=esp.server_port, control_token=TOKEN)), encoding='utf-8')
                process = subprocess.Popen([sys.executable, '-X', 'utf8', '-u', str(folder / 'server.py')], cwd=folder,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    deadline = time.monotonic() + 5
                    while len(mock.requests) < 2 and time.monotonic() < deadline:
                        self.assertIsNone(process.poll(), 'Relay unexpectedly exited')
                        time.sleep(.03)
                    self.assertGreaterEqual(len(mock.requests), 2, 'Heartbeat worker died after an idle failure')
                    before = len(mock.requests)
                    online[0] = True
                    deadline = time.monotonic() + 3
                    while len(mock.requests) < before + 4 and time.monotonic() < deadline:
                        time.sleep(.03)
                    self.assertGreaterEqual(len(mock.requests), before + 4)
                    self.assertTrue(all(action == 'heartbeat' for action, _, _ in mock.requests))
                    self.assertFalse(mock.armed)
                finally:
                    process.terminate()
                    stdout, stderr = process.communicate(timeout=5)
                self.assertNotIn(b'Traceback', stderr)
                self.assertIn(b'Local car controller:', stdout)
        finally:
            esp.shutdown()
            esp.server_close()


if __name__ == '__main__':
    unittest.main()
