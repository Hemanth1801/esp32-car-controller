# S3 validation — 2026-10-25

## Live camera orientation correction — 2026-10-26

- Added a saved camera orientation selector to desktop and Quest pages, defaulting to 180 degrees for the reported upside-down camera mounting. Correction applies to camera pixels only; HUD, interior, generated Practice and camera-loss panel remain upright. Normal, vertical-only and mirror-only modes are also available. Camera freshness and motor command handling are unchanged.
- Verified all four colored corners through the real renderer using both Canvas uploads and JPEG/ImageBitmap decoding. Checked desktop CSS transforms, saved selection after reload, upright Practice/lost-video panels, no WebGL exceptions and zero motor requests. Browser helper: `qa_camera_orientation.mjs`.
- Changes are webpage assets only and require a page reload. No ESP upload or relay restart was performed. Final physical scene orientation requires the user's visual confirmation.

## Classic app control rejection fix — 2026-10-26

- Reproduced the reported control 409 with two independent relays sharing a simulated classic board. The combined relay's idle worker saw an armed board without a local owner and sent Stop, invalidating the original app's session.
- Classic/dual idle polling now observes foreign sessions without stopping or adopting them. Explicit Emergency Stop still stops the board. Arm requests that encounter an already-armed board are refused without sending an automatic recovery Stop to that valid owner.
- Added three regression tests: idle observer leaves classic control/session intact, conflicting Arm leaves its owner intact, and Emergency Stop from the other app still disarms. All 54 Python tests pass. Restarted only the combined relay; both real status endpoints report connected and neutral/disarmed. No live Arm/Control requests were sent. All 97 original files remain unchanged.
- Desktop and two-board Quest browser regressions passed against simulated devices. The Quest Arm helper now waits for the same connection/remote-owner readiness required by the page, avoiding an A press during the simulated disconnect/recovery checks.

## GT cockpit visual update — 2026-10-26

- Replaced the box-shaped interior with a curved upholstered dashboard, leather rim and stitching, detailed vents/console, smaller carbon weave, brushed-metal trim and smoked side glazing. Added inverse-transpose normal handling, roughness/metallic response, mipmaps and restrained environment reflections. Camera pixels bypass material lighting.
- Static cabin and animated wheel are batched separately: 20 cabin + 13 wheel draws per eye, 81,262 geometry triangles plus three display/video planes. This is a scene count, not a physical-headset frame-rate measurement.
- Captured and inspected `artifacts/quest-gt-cockpit.png` and `quest-gt-page.png` in Practice. The preview helper recorded zero motor requests and no WebGL errors. The live trusted HTTPS site was checked against all three changed local assets.
- Firmware, relay protocols and original classic files are unchanged. Physical Quest 2 graphics performance remains unverified. Requested telemetry is labelled honestly; decorative side/mirror glass provides no rear or side video coverage.

## Two-board configuration — 2026-10-26

- Built and uploaded camera-only firmware to the identified S3 on COM10; esptool verified written hashes. Actual authenticated status confirms camera-only role, disabled motor outputs, disarmed state, OV3660 PID 0x3660 and camera ready at 192.168.1.22.
- Old ESP32 authenticated separately at 192.168.1.12 with its existing firmware/token. The original 97 recorded files still match their hashes. Motor choices, including disabled command timeout, are unchanged.
- Combined relay is running in `--profile dual`. Verified both roles, neutral/disarmed motor state, live advancing JPEG frames and trusted HTTPS Quest page. Result: `artifacts/dual-live-verification.json`.
- All 51 Python tests and nine JavaScript suites passed. Four isolated browser suites passed, plus an additional Quest run with separate simulated motor/camera boards. Routing tests reject wrong roles, shared tokens/endpoints and camera motor commands; idle camera traffic cannot renew a motor session/deadline.
- Launcher reuse verified with `start-dual.ps1 -NoBrowser`. Setup, connections and remaining physical tests are in [TWO-BOARD.md](TWO-BOARD.md). No live Arm/Control requests were sent. The earlier camera errors and single-S3 upload records below are historical.

Physical diagram update, 2026-10-26: the wiring page now uses the actual supplied board photo with colored pad-to-driver connections, both motors, USB/driver power, supply capacitors and common ground. The compact header illustration remains available separately. SVG and printable PNG were rendered and inspected; firmware and the classic project were not changed.

## Camera now working ? 2026-10-26

- User reseated/reconnected the camera. USB-UART COM10 then exposed a repeated FreeRTOS null-semaphore assertion. The original matching ELF decoded the trace through lwIP socket creation to `httpd_start` inside camera setup, before Wi-Fi initialization.
- Split sensor initialization/JPEG validation from video-server startup. Create the camera HTTP server only after the station obtains an IP; retry a failed server start at bounded intervals. Status distinguishes sensor readiness from stream-server readiness.
- Rebuilt and flashed through COM10, confirming the same S3 MAC and verifying flash image hashes. Actual status now reports **OV3660, PID0x3660, ESP_OK, camera ready, 8 MB PSRAM**, Wi-Fi192.168.1.22 and **disarmed**.
- Verified five advancing 640?480 JPEG frames through the computer relay (about12KB/frame, observed relay delivery ages30?133ms). A captured JPEG decoded successfully. This measures delivery freshness, not end-to-end camera latency. Current result is in `artifacts/camera-live-verification.json`.
- The earlier generic camera error and later ESP_ERR_NOT_SUPPORTED observations below are historical. The sensor is now detected and streaming. Powered motor tests remain pending. No Arm/Control requests were sent.

## Initial hardware upload ? 2026-10-26

- Uploaded the native-USB CDC build to the confirmed ESP32-S3 on **COM9**, MAC **10:51:db:78:9d:30**. esptool verified every written flash image hash. Hardware reports **16 MB flash** and **8 MB PSRAM**. Build: 1,081,098 application bytes; 61,292 static RAM bytes.
- After releasing BOOT and resetting, authenticated Wi-Fi discovery found **192.168.1.22**. Device status confirms S3 identity, 8,388,608 PSRAM bytes and **disarmed** startup.
- The separate S3 desktop/phone/Quest relay is running. Actual idle heartbeat acknowledgements were verified at 50 ms cadence without Arm or Control requests. Defaults remain output enabled after Arm, steering hold and command timeout OFF.
- **Camera initialization failed**: sensor PID0, ready=false. Ribbon attachment/contact orientation and the expected S3-EYE camera profile remain to be verified. No valid physical camera frame has been confirmed.
- No powered motor test was performed. The classic firmware and all97 recorded classic files remain unchanged. Upload details and the configured binary hash are in `artifacts/upload-verification.json`.

## Software checks completed before upload

- Classic preservation: SHA-256 manifest recorded before migration; **all97 recorded original files unchanged**, including firmware, launchers, local configuration and existing phone certificates. Only the new S3 folder and `choose-controller.cmd` were added. Existing desktop shortcuts were not edited.
- Package isolation: separate control tokens, hostname, certificates, settings/storage keys, configuration files, source/build directories and controller ports. S3 rejects a classic identity and the other package's token. PowerShell launcher/build syntax checked.
- **Configured S3 firmware compiled** with Arduino-ESP32 3.3.12 / ArduinoJson7.4.3, `esp32:esp32:esp32s3`, QIO80MHz, 16MB flash, OPI PSRAM, 3MB application partition. Flash: **1,085,918 bytes / 3,145,728**; static RAM: **61,100 / 327,680 bytes**. Build output is local `artifacts/configured-firmware`; it contains configured credentials and must not be shared.
- **43 Python tests passed**: ownership, sequences, stale sessions, Stop/Arm races, relay failures, idle cadence/no page, neutral commands, heartbeat/Arm contention, no watchdog renewal, malformed heartbeat isolation, wrong board/token, camera authentication/no redirect leakage, video bounds/freshness, discovery/reconnect, HTTPS/origins and CA renewal. A subprocess test executes `server.py` as `__main__` and verifies heartbeat failure/recovery without dying or replaying movement.
- **9 JavaScript suites passed**: calibration, axis selection, brake/reverse, Button0, automatic-arm policy, control-session timing/races, diagram/input parity, phone input and Quest Touch input.
- Native C++ motor tests passed: L298N direction/dead-time/PWM/full duty, enabled/disabled output, 250ms optional pulse, continuous hold, enabled/disabled timeout, network loss, invalid owner/session, stale sequences and timer wraparound.
- **4 isolated Chrome suites passed** against a simulated ESP: desktop wheel/pedal/keyboard controls and calibration; phone HTTPS/motion/buttons; racing cockpit with synthetic XR and video-loss stops; S3 desktop live JPEG/stale hiding, idle acknowledgements and the physical wiring diagram. Browser fixtures include the 50ms heartbeat worker and use ports8866/9543/CDP9337, separate from both real controllers. No live motor API was used.
- S3 phone certificates generated for the computer's current LAN address using a separate CA. Nothing was installed into Windows/phone/headset trust automatically.
- Read-only Arduino serial enumeration found **COM5 and COM6**, without a recognized board identity. Neither port was opened/reset/flashed. The upload helper performs an explicit ESP32-S3 chip check before writing; no COM7 assumption.

## Hardware checks pending

Software validation does not establish physical camera routing, motor direction, supply capability or steering temperature. The S3 upload and Wi-Fi/PSRAM checks are now complete as recorded above; physical camera and powered motor checks remain pending.

1. The S3 has been uploaded and its IP/PSRAM/disarmed state verified. Keep motor power off while resolving the camera init failure and confirming expected OV3660 PID0x3660 plus a valid JPEG.
2. Confirm the photographed board really uses the documented S3-EYE ribbon profile. If sensor init fails, verify the board schematic and ribbon contacts before changing GPIO assignments. Leave motor power off during camera bring-up.
3. Check the actual motor VS supply, 5V logic terminal and removed5V-EN jumper, common ground, removed ENA/ENB jumpers, pull-downs and driver capacitors. Verify PWM frequency/resource separation while camera capture is active.
4. Raise and secure the wheels. At neutral, Arm and briefly test drive/steer direction, full-duty operation, centre release and Emergency Stop. Power off before swapping output leads. Check motor/driver temperature and avoid steering end-stop stalls.
5. Test Wi-Fi interruption, USB power loss/reboot and computer shutdown. Wi-Fi loss/reboot/Stop disarm. **With the configured 400ms timeout OFF, computer/control-stream loss alone may leave a last motor output active while ESP Wi-Fi remains connected.** This is the user's retained setting, not an untested promise of automatic stopping. Restore `COMMAND_TIMEOUT_ENABLED true` and reflash when desired.
6. Under motor load, verify camera continuity, controller acknowledgements, supply voltage dips, driver heating and the 5V/2A bank's ability to start both motors. Idle traffic cannot prevent a power reset.
7. Trust the new CA on the physical phone/Quest2, then verify real motion/WebXR controllers, live video and latency. Synthetic browser checks do not verify headset hardware or end-to-end camera delay.

## Repeat checks

```powershell
python verify-classic.py
python -X utf8 -m unittest discover -s tests -p 'test_*.py' -v
Get-ChildItem tests -Filter test_*.js | ForEach-Object { node $_.FullName }
.\tests\test_native.ps1
.\tests\run-browser.ps1
.\build-firmware.ps1
```

Browser helper launches only isolated headless Chrome and simulated local ESP servers and stops those test processes. Its certificate-warning bypass is for tests only; normal phone/Quest access requires trusting this package's CA. Some test/development dependencies may require normal Windows access outside an automation sandbox.

Camera diagnostics update, 2026-10-26: rebuilt and uploaded the S3 firmware with exact esp_camera_init error name/code exposed in status. Live status reports ESP_ERR_NOT_SUPPORTED (262 / 0x106), ready=false. The installed S3 qio_opi sdkconfig confirms CONFIG_OV3660_SUPPORT=1. This error does not identify a defective camera or prove the ribbon is disconnected; physical ribbon seating/orientation, actual sensor model and board camera routing still require verification. The desktop preview now displays the ESP camera failure message. Motor settings were unchanged and no Arm/Control requests were sent.
