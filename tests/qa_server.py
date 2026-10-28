"""Temporary browser QA fixture on 8766, with an in-process simulated ESP."""
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Relay, make_server
from mock_esp import MockESP, TOKEN, mock_server

mock = MockESP()
esp = mock_server(mock)
threading.Thread(target=esp.serve_forever, daemon=True).start()
relay = Relay(dict(esp_host='127.0.0.1', esp_port=esp.server_port, control_token=TOKEN, timeout_seconds=.15))
server = make_server(relay, 8766)
tls = (Path(__file__).resolve().parents[1] / '.mobile/server.crt', Path(__file__).resolve().parents[1] / '.mobile/server.key')
phone_server = make_server(relay, 9443, tls=tls)
threading.Thread(target=phone_server.serve_forever, daemon=True).start()
print('Browser QA fixture at http://127.0.0.1:8766 (simulated ESP only)', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
    phone_server.shutdown()
    phone_server.server_close()
    esp.shutdown()
    esp.server_close()
