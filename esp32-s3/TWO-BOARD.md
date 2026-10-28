# Old ESP32 motors + ESP32-S3 camera

This profile runs the existing racing cockpit, desktop and phone controls with two independently authenticated boards. The old ESP32 controls the L298N. The S3 supplies OV3660 video only. There are no signal wires between the two ESP boards; both communicate with the computer over the shared Wi-Fi.

The original app on port 8765 can remain running. Two-board idle status checks observe an armed session belonging to that app without stopping or adopting it. Disarm the current driving page before switching apps; a second app's Arm request reports an ownership conflict. Emergency Stop remains available from either app.

## Open the controller

Double-click `start-dual.cmd` in this folder. Alternatively, run `..\choose-controller.cmd`, choose **3 — Old ESP32 motors + ESP32-S3 camera**, then choose desktop, phone or Quest.

| Page | Current address |
|---|---|
| Computer wheel / keyboard | http://localhost:8865/controls |
| Quest Browser | https://192.168.1.11:8867/quest |
| Phone controls | https://192.168.1.11:8867/phone |
| Phone / Quest certificate setup | http://192.168.1.11:8868 |

Keep the computer running and all devices on the same LAN. The launcher prints the current computer address if it changes. Install/trust this S3 package's local CA on the phone/headset using the setup page. Quest starts in Practice; choose Live car explicitly when fresh video is available. Centre inputs before Arm. Use one active driving page at a time, including pages in the old application at port 8765.

To select controls from PowerShell:

```powershell
.\start-dual.ps1 -Controls desktop
.\start-dual.ps1 -Controls phone
.\start-dual.ps1 -Controls quest
```

Single-S3 mode and this two-board profile share ports 8865/8867/8868. Close the running S3 relay before switching profiles. The original classic application and its shortcut remain unchanged.

## Hardware connections

Keep the motor driver connected to the **old ESP32**, using its existing physical diagram at http://localhost:8765/wiring when the classic app is running.

| Old ESP32 board label | L298N |
|---|---|
| D25 / GPIO25 | IN1 — drive |
| D26 / GPIO26 | IN2 — drive |
| D27 / GPIO27 | IN3 — steering |
| D14 / GPIO14 | IN4 — steering |
| D32 / GPIO32 | ENA — drive PWM |
| D33 / GPIO33 | ENB — steering PWM |
| GND | GND / common supply negative |

Drive motor connects to OUT1/OUT2; steering motor connects to OUT3/OUT4. Remove ENA/ENB jumpers for PWM. Retain the confirmed regulated 5 V logic supply with the separate **5V-EN jumper removed**, existing 5 V motor supply to VS/+12V, common ground, input pull-downs and driver capacitors. Power each ESP through one USB input. Switch all power off before changing wiring.

The **S3 needs only USB power and its latched OV3660 camera ribbon**. Leave its former motor GPIO wires disconnected. The S3 photo diagram in this package describes the optional single-S3 motor configuration; it is not the motor wiring for this profile.

## Firmware and pairing

- Old ESP32: existing firmware and token, authenticated at **192.168.1.12**. No reflash or original configuration edits were needed.
- S3: camera-only firmware uploaded through the verified S3 on **COM10**, authenticated at **192.168.1.22**. Its status reports `device_role: camera-only`, motor outputs disabled, OV3660 PID 0x3660 and camera ready. USB port numbers can change.
- Separate local pairings are stored in ignored `.dual/relay.local.json`; camera preferences are `.dual/camera.local.json`. Tokens are distinct and never included in browser video URLs. Discovery verifies the expected role with its token.
- S3 camera-only rejects Arm/Control. The relay sends motor commands only to the classic board. While idle, the classic board receives read-only status requests every 50 ms, and the S3 receives camera heartbeats every 50 ms. The classic firmware has no heartbeat endpoint. Fresh motor commands, including neutral, continue every 50 ms while armed; missed commands are not queued or replayed.
- Existing motor choices are retained: 100% drive limit, continuous steering hold, **400 ms command timeout disabled**. With this timeout disabled, loss of computer commands alone can leave the last motor output active while the ESP remains on Wi-Fi. Heartbeats do not change motor outputs or enable a timeout.

Rebuild/upload the camera role with motor power off and the actual S3 serial port:

```powershell
.\build-firmware.ps1 -CameraOnly -NativeUSB -Port COMx
```

Omitting `-CameraOnly` builds the optional single-S3 car firmware. Reflash that mode before using the S3 itself for motors. The upload helper verifies the chip is an S3 before writing.

## Verification

On 2026-10-26 both boards authenticated independently and remained disarmed. Five advancing JPEG frames were received through the combined relay; OV3660 reported 640×480, up to 10 fps. The Quest page passed HTTPS validation against the package CA. See `artifacts/dual-live-verification.json`.

All 51 Python tests, nine JavaScript suites and four simulated browser suites passed, with an additional Quest browser run in two-board mode. Tests cover routing, wrong roles/tokens, ownership, stale commands, stop races, camera loss and heartbeat isolation. All 97 original project file hashes remain unchanged.

No real Arm/Control tests were sent. Powered motor operation, video under motor load, physical Quest controllers, headset certificate trust and end-to-end video latency still require checks with the car's wheels raised.
