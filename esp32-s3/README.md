# ESP32-S3 N16R8 car + OV3660 camera

**Current hardware setup: old ESP32 for motors, S3 for camera only.** Run `start-dual.cmd`, or choose option 3 in the parent selector. See [TWO-BOARD.md](TWO-BOARD.md) for the current launch addresses, old-board wiring and verified camera-only upload. The single-S3 motor wiring and build instructions below describe the other available configuration.

This is the **new, separate S3 package**. The classic ESP32 project remains in the parent folder, unchanged. Use `..\choose-controller.cmd` to choose the board and computer, phone, or Quest controls. Existing desktop shortcuts still open the classic package.

## Run

From this folder, double-click:

- `start.cmd`: computer wheel/pedals or keyboard, **http://localhost:8865**.
- `start-mobile.cmd`: phone setup **http://COMPUTER-IP:8868**, then controls **https://COMPUTER-IP:8867/phone**.
- `start-quest.cmd`: racing cockpit at **https://COMPUTER-IP:8867/quest**; starts in Practice.

The computer hosts every page and must stay running. ESP, computer and phone/headset must share the same LAN with client isolation off. ESP32-S3 uses **2.4 GHz Wi-Fi**, even if the router's SSID contains “5G”. Phone motion, phone camera and WebXR require trusting this S3 package's own local CA. It is separate from the classic controller's CA. Launchers print the current computer address; the certificate setup page explains trust installation. `enable-phone-access.ps1` is an optional Administrator helper for S3 ports only; it does not edit the classic firewall rule.

The S3 firmware must be uploaded before controls can connect. Pages can open while it is offline, and the relay discovers/retries automatically. Firmware hostname is **esp-car-s3.local**. The configured `192.168.1.250` address is only an initial discovery hint, not a static IP assigned to the ESP. Launch discovery replaces it after finding the authenticated board; do not point this package at the old ESP32.

## Wiring

Open **http://localhost:8865/wiring**, or see [the full physical connection diagram](web/wiring.svg), [printable PNG](wiring-physical.png), [simplified header pinout](web/header-pinout.svg) and [the supplied photograph](web/board-photo.jpeg). The full diagram marks pads directly on your photo and includes the L298N, both motors, regulated 5 V supplies, capacitors and common ground. Face the component side with antenna up and USB down. Labels are GPIO numbers, not physical pin numbers.

| S3 label | Header position | L298N |
|---|---|---|
| **1** | Right, third from top | IN1, drive |
| **14** | Left, second from bottom | IN2, drive |
| **21** | Right, fourth from bottom | IN3, steering |
| **47** | Right, fifth from bottom | IN4, steering |
| **41** | Right, sixth from top | ENA, drive PWM |
| **42** | Right, fifth from top | ENB, steering PWM |
| **GND** | Right, bottom | Common GND |

Drive motor → OUT1/OUT2. Two-wire spring-return steering motor → OUT3/OUT4. With all power off, remove **ENA/ENB jumpers**. Add 10 kΩ pull-downs from IN1–IN4 and ENA/ENB to GND. Motor leads do not connect permanently to GND.

Keep the **separate 5V-EN regulator jumper removed** and feed regulated **5 V to the driver logic 5V terminal**. Your existing **5 V motor supply feeds VS / +12V**; “+12V” is the terminal label, not an instruction to increase the supply. Join ESP/driver/supply grounds and route motor current directly through power wiring. Fit **100 µF bulk + 100 nF ceramic** near the driver supply and verify its flyback diodes. The bank's 5 V/2 A motor-start capability and the L298N's loaded voltage drop remain physical checks.

Power the ESP through **one USB input**; do not also feed its 5V header. Do not infer USB-UART/native USB sides from the photo; identify the port from board markings/device enumeration. Keep USB19/20, UART TX/RX, PSRAM35–37, boot0/3/45/46 and RGB48 free.

OV3660 uses the ribbon socket. Insert with power off and verify socket/contact orientation. Expected **S3-EYE-compatible profile**: SDA4, SCL5, XCLK15, VSYNC6, HREF7, PCLK13; D0–D7 = 11/9/8/10/12/18/17/16. The photograph establishes header positions, not the hidden ribbon routing: sensor identification and a valid JPEG must be checked with motor power off.

## Build and upload

Last successful hardware upload: **2026-10-26, COM9, native USB CDC enabled**. S3 joined Wi-Fi at **192.168.1.22**, with 16 MB flash and 8 MB PSRAM verified. For this USB connection use `-NativeUSB` on later builds/uploads. Camera detection and live 640?480 JPEG streaming are now verified as OV3660. The latest fix was uploaded through the USB-UART port COM10, retaining native USB CDC support.

The package reads Arduino CLI/core and certificate-generation dependencies from the parent's `.tools` folder. Configurations, certificates, firmware sources and build outputs are independent. Keep the folder in this location to use these helpers. Runtime relay/video code uses Python's standard library; certificate creation additionally uses the existing cryptography dependency.

```powershell
cd 'C:\Users\saihe\car esp\esp32-s3'
.\build-firmware.ps1
# Motor power OFF; substitute the actual S3 serial port:
.\build-firmware.ps1 -Port COMx
```

The default build uses USB-UART serial115200. For native USB, add `-NativeUSB` to compile with USB CDC enabled. The upload helper checks **ESP32-S3 identity before any flash write**, and esptool refuses classic ESP32. No port is assumed. If needed, hold BOOT, tap RESET and retry, releasing BOOT when writing starts. Do not erase or upload the classic board using this package.

Arduino IDE equivalent: **ESP32S3 Dev Module**, 16MB flash, QIO80MHz, OPI PSRAM, **16M Flash (3MB APP/9.9MB FATFS)**, upload115200, Arduino-ESP32 **3.3.12**, ArduinoJson7.4.3. Camera support comes with the ESP32 core. Firmware also has a compile-time S3 target guard.

Serial115200 prints PSRAM size, camera sensor PID and verified JPEG initialization, PWM timer allocation and Wi-Fi IP. Expected OV3660 PID is **0x3660**. Missing camera leaves desktop line-of-sight driving available; Quest Live cannot arm without fresh video. Camera profile/init failure is reported through status.

## Controls, video and idle connection

- Existing keyboard W/S/A/D, Space Stop, wheel/pedal calibration, reverse/brake feedback, Button0 pause/resume, phone tilt/split buttons and the racing cockpit are retained. This origin and its storage keys are separate from classic calibration; set up pedals in the S3 page.
- Current configured defaults: motor output enabled **after Arm**, 100% drive limit, continuous steering hold, **400 ms command timeout OFF**. Stop, reboot, Wi-Fi loss, invalid sessions and stale command sequences still disarm. Focus/visibility loss and input-source changes send Stop. Steering diagram shows requested effort, not measured angle.
- With timeout off, a last output can persist if controls stop arriving while ESP Wi-Fi stays connected. It is deliberately unchanged from your choice. Set `COMMAND_TIMEOUT_ENABLED true` in this package's ignored config and rebuild/upload when you want the 400 ms deadline restored.
- Relay sends authenticated **POST /api/heartbeat every50ms while disarmed**, even without a browser. Heartbeats never arm, change motor inputs, advance sequences or renew a motor-command deadline. Armed ownership sends only fresh controls, including neutral, every50ms. Busy/missed ticks are skipped; reconnect does not replay movement.
- Status shows board/camera identity, traffic mode and last idle acknowledgement age. Arm/Control/Stop take priority over idle work. Idle failures back off and rediscover using authenticated status, not just a UDP hint. Heartbeats cannot repair motor-power brownouts or Wi-Fi interference.
- The same S3 streams authenticated VGA640×480 JPEG, quality16, at up to10fps on port81 `/stream`. The PC relay obtains its URL only from the paired board. The token is sent as a header only to that endpoint, never to a browser-visible URL or manual camera source; redirects are refused.
- Latest-frame video is shared by the desktop preview and Quest windshield. Select Live explicitly in Quest; video reconnection never selects Live or arms. The cockpit remains the existing racing interior. This is one camera image for both eyes, without head-controlled camera movement.
- To use a phone camera, disconnect the onboard source on the Quest page, then open `/camera` on the phone and start its camera. A manual local JPEG/MJPEG address is also supported. Use **Use paired S3 onboard camera** to switch back. Video errors never send motor commands.

Camera XCLK owns LEDC timer0/channel0. Motors use explicit ESP-IDF low-speed timer1/channels2–3 at20kHz/8bit, including full-duty handling. The independent motor task never holds its mutex during capture/streaming. Camera HTTP runs in a separate lower-priority task.

## Configuration and checks

Ignored `relay.local.json`, `wifi.local.json`, `camera.local.json`, `firmware/car_controller/config.h` and `.mobile` belong only to this package. A fresh control token and separate CA were generated. Do not share these files, configured firmware binaries or private keys. To change Wi-Fi, use `python configure_wifi.py 'path\to\credentials.txt'`, then rebuild/upload; existing S3 pairing and motor-mode choices are retained. `setup.py` refuses to overwrite an existing pairing.

See [VALIDATION.md](VALIDATION.md) for tested and pending checks. Run `python verify-classic.py` to compare all97 recorded original project files with their pre-migration hashes. No classic process needs to be stopped to run this package on its separate ports.

References: [manufacturer camera-family pin profile](https://docs.keyestudio.com/_/downloads/MB0184/en/latest/pdf/), [Espressif camera driver](https://github.com/espressif/esp32-camera), [LEDC](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/ledc.html), [ST L298](https://www.st.com/resource/en/datasheet/l298.pdf).

## Car battery display

Desktop, phone and Quest setup pages display car battery telemetry from the motor ESP's existing status/control responses. Refresh the page to load the indicator. No additional requests or motor commands are sent for battery monitoring.

The current firmware and wiring do not include a battery sensor, so the indicator shows **Unavailable**. Powering the ESP from a USB power bank does not provide a battery reading in this project's API. Actual charge needs a fuel gauge or a battery monitor connected to the ESP; its implementation depends on the battery type and sensor. Do not connect battery power directly to a GPIO.

The display accepts an optional status object `"battery": {"percent": 72, "voltage": 3.91}`. `percent` must be a number from 0 to 100; `voltage` must be a positive number in volts. Either may be omitted. Voltage alone is displayed in volts and never converted to an invented charge estimate. Missing, invalid, `available: false`, or `fresh: false` readings show Unavailable; disconnects clear the displayed reading. In the two-board profile the reading belongs to the motor ESP, not the camera S3.
