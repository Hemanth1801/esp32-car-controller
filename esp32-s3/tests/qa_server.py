"""Temporary browser QA fixture on 8866, with an in-process simulated ESP."""
import sys
import argparse
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Relay, make_server
from mock_esp import MockESP, TOKEN, mock_server
from heartbeat import IdleHeartbeat

parser = argparse.ArgumentParser()
parser.add_argument('--dual', action='store_true')
args = parser.parse_args()
camera = None
if args.dual:
    from test_dual_board import device_server, MOTOR_TOKEN, CAMERA_TOKEN
    from dual_board import DualRelay
    esp, mock, motor_calls = device_server('motor')
    camera, camera_model, camera_calls = device_server('camera')
    relay = DualRelay(dict(esp_host='127.0.0.1', esp_port=esp.server_port, control_token=MOTOR_TOKEN,
        timeout_seconds=.15, camera_device=dict(esp_host='127.0.0.1', esp_port=camera.server_port, control_token=CAMERA_TOKEN)))
    relay.camera_peer.start()
else:
    mock = MockESP()
    esp = mock_server(mock)
    threading.Thread(target=esp.serve_forever, daemon=True).start()
    relay = Relay(dict(esp_host='127.0.0.1', esp_port=esp.server_port, control_token=TOKEN, timeout_seconds=.15))
server = make_server(relay, 8866)
tls = (Path(__file__).resolve().parents[1] / '.mobile/server.crt', Path(__file__).resolve().parents[1] / '.mobile/server.key')
phone_server = make_server(relay, 9543, tls=tls)
threading.Thread(target=phone_server.serve_forever, daemon=True).start()
print('Browser QA fixture at http://127.0.0.1:8866 (simulated ESP only)', flush=True)
heartbeat = IdleHeartbeat(relay)
heartbeat.start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    heartbeat.close()
    if camera:
        relay.camera_peer.close()
        camera.shutdown()
        camera.server_close()
    server.server_close()
    phone_server.shutdown()
    phone_server.server_close()
    esp.shutdown()
    esp.server_close()
