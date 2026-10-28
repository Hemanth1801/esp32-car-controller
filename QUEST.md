# Quest 2 cockpit

Run **start-quest.cmd** on this computer. Keep the local relay running and connect the Quest and computer to the same Wi-Fi. Practice works without an ESP or camera. Connect those devices to the same Wi-Fi later for live driving. No motor-controller firmware changes or APK installation are needed for the cockpit.

The current computer address is `192.168.1.11`; if it changes, use the address printed by the launcher. Open **https://192.168.1.11:8767/quest** in Meta Quest Browser. The desktop preview is **http://localhost:8765/quest** and cannot drive the car.

## Try it now, without a camera

Every new page starts in **Practice — no motor commands**. Enter VR with both Touch controllers, release triggers and centre the left stick, then press A. Hold right grip and try steering/forward/reverse in the generated practice view. A and B only arm/stop the local practice session; they do not send motor API requests or interrupt another real controller. The red on-screen Emergency Stop remains a real stop button in either mode. Practice works even when the motor ESP is offline.

Camera video can connect in the background, but it never switches Practice into real driving. Choose **Live car — camera required** explicitly, then press A again at neutral. Changing modes disarms. Live car still requires fresh video, tracking and a connected ESP. The camera's reconnect loop never arms the car.

## Phone as the camera

1. Connect the phone to the same Wi-Fi as this computer.
2. Open **https://192.168.1.11:8767/camera** in Chrome or Safari (use the launcher's computer address if it changes).
3. Allow camera access and tap **Start rear camera**. If needed, complete the certificate setup at **http://192.168.1.11:8768** first.
4. Secure the phone on the car facing forward. Keep the camera page visible and the phone unlocked. The page requests a screen wake lock when the browser supports it.
5. In the Quest cockpit, choose **Live car**, enter VR, release triggers/centre the stick, then press A. Hold right grip to enable movement.

The phone sends up to 10 fps at 640 × 360, without audio or recording. Only one source publishes at a time: disconnect an active IP camera before starting the phone camera. Stopping/hiding the phone page stops its video, so live driving disarms. On iOS, trust the local CA and enable full trust as described on the existing setup page.

## Add an ESP32-CAM later

This workspace already has a **compiled camera companion** for a separate **AI Thinker ESP32-CAM with OV2640**. Its ignored local config uses the project's Wi-Fi credentials and a dedicated camera pairing key. No camera firmware has been uploaded, and the motor ESP is unchanged. Verify the camera board model before flashing; other ESP camera pin layouts require their matching configuration.

When that separate board is available, flash `firmware/car_camera/car_camera.ino` using the **AI Thinker ESP32-CAM** board profile. `prepare-camera.cmd` regenerates its local Wi-Fi configuration while preserving pairing and compiles it; it never uploads. The compiled files are in ignored `artifacts/camera-firmware`. Do not flash them to the existing motor-controller ESP.

After this one-time flash/Wi-Fi setup, power the camera on and leave **Find paired ESP32-CAM automatically** enabled. The relay finds it using signed UDP discovery on port 8770, remembers its identity, reads its video and reconnects after camera/router restarts or a changed camera IP. Discovery only accepts the paired key, fresh nonce, camera identity and signed stream endpoint. It does not scan the subnet or issue motor commands. If the router/firewall blocks broadcast, use the manual stream address instead. Replacement camera identities require clearing `camera_id` in ignored `camera.local.json` while the relay is stopped, then restarting it.

Use a suitable regulated supply for the separate camera board. Actual camera voltage/current requirements depend on its board; do not connect it to motor-driver outputs.

## Other Wi-Fi camera setup

The camera model and address are not yet known, so actual live video is not configured or verified. The existing ESP32 DevKit is the motor controller; it does not capture video. An ESP32-CAM is a separate board with a camera and its own suitable power supply.

1. With motor power off, connect and configure your camera for the shared Wi-Fi. Find its model and stream address in its serial output, setup page or the router's device list. A setup page is different from a stream address.
2. On the cockpit setup page, enter its **HTTP JPEG or MJPEG stream address**, then choose **Apply camera address**. For Espressif's CameraWebServer example, the common stream path is `http://CAMERA-IP:81/stream` and a snapshot path is `http://CAMERA-IP/capture`. Replace CAMERA-IP with the camera's actual private IPv4 address; these are examples, not discovered addresses.
3. MJPEG parts must contain JPEG Content-Type and Content-Length. Frames are limited to 192 KiB; start at 640 × 480 or smaller. RTSP, HLS, camera login pages, embedded passwords, redirects and public addresses are not supported. A camera that only provides RTSP needs a local transcoder, which this version does not include.
4. Wait for video to arrive, then choose **Live car**. The ignored `camera.local.json` remembers the chosen address. After a stream error it retries automatically; reconnection never re-arms the car. A generic Wi-Fi camera needs its JPEG/MJPEG address once, and it may need an updated address if its IP changes. Signed automatic identity discovery is provided only by the companion firmware, not arbitrary camera products.

The Python relay reads the camera on a separate thread, stores only the latest frame in memory, and serves it to the Quest over the existing HTTPS listener. It does not save video, send audio, or use cloud services. Cameras may compress or buffer internally: delivery age does **not** prove end-to-end camera latency. Repeated ESP camera timestamps are ignored, but a camera that stamps old images as new cannot be identified reliably. This is an initial low-bandwidth preview (Quest fetches up to 10 fps), not a guaranteed low-latency FPV system.

Invalid video requests never issue motor commands.

## Enter VR and drive

Use **Enter VR cockpit**, with both Touch controllers tracked. The scene places you in the driver's seat of a stationary 3D racing car, with a carbon-style dash, animated flat-bottom wheel, roll cage, side console, bucket seat and harness. You can look around the cabin with headset tracking. The wheel turns with requested steering; the digital dash shows requested drive/steering and forward/reverse/neutral, not measured vehicle speed, RPM or wheel angle. Use the Touch stick/triggers; the decorative cockpit switches are not extra controls.

Practice shows a generated race circuit beyond the windshield. Live car puts the front camera image in that windshield. The cabin has stereo depth, but both eyes see the same flat camera image; looking around does not pan the camera and there is no stereo depth from the video. The windshield frame/bodywork can obscure image edges, as a physical cockpit would. The on-dash information display retains arm/stop, video freshness and command-timeout state.

| Control | Action |
| --- | --- |
| A, right controller | Arm at neutral / disarm |
| Right grip, held | Enable drive and steering; release sends zero to both |
| Left thumbstick X | Requested steering |
| Right trigger | Forward |
| Left trigger | Reverse |
| B, right controller | Emergency Stop |

Before pressing A, release both triggers and centre the left stick. Releasing the grip cannot hide non-neutral inputs from the arming check. Pressing both triggers disarms. Drive power defaults to 100%, matching this project's current setting; the slider limits drive only. Quest settings are stored separately under `espCarQuestV1`.

Live car uses the existing owner/session/sequence protocol and 50 ms command loop. Fresh video, a visible immersive session, headset tracking and both tracked Touch controllers are required. Frames older than 750 ms, controller samples older than 180 ms, controller/source changes, menus, session end, graphics loss, page hiding and changed settings cause Stop/disarm. Press A again at neutral after resolving the problem; there is no automatic re-arm. Right-grip release is a zero-output command, not an ownership release. Practice has the same tracking/input gates but needs no video or connected ESP.

**The ESP's 400 ms command timeout remains OFF as previously requested.** Browser Stop requests cannot guarantee stopping if the computer/browser fails or requests cannot reach the ESP while its Wi-Fi remains connected. The last motor output can persist. The cockpit displays this mode and does not change the firmware setting. Physical VR driving is unverified. Test with wheels raised, motor power controlled by a helper, and short steering movements before ground use.

## HTTPS and headset troubleshooting

The page detects immersive support rather than assuming it from the device name. WebXR needs a secure context. Accept/trust only this project's local certificate, using the existing certificate setup page at **http://COMPUTER-IP:8768** where supported. A warning bypass alone may not grant WebXR permission on every browser version. If the VR button stays unavailable, check Meta Quest Browser site permissions and the page's support message.

For a development fallback, Meta documents USB ADB reverse: after enabling developer mode, installing Android Platform Tools and allowing the headset's USB debugging, run `adb reverse tcp:8765 tcp:8765`, then open **http://localhost:8765/quest** in the headset. This maps the headset's loopback to this computer; it is a USB development path rather than wireless access. No ADB tools are installed by this project.

References: [Meta WebXR overview](https://developers.meta.com/vr/documentation/web/webxr-overview/), [Meta local headset workflow](https://developers.meta.com/vr/documentation/web/webxr-first-steps/), [Meta ADB browser workflow](https://developers.meta.com/vr/documentation/web/browser-remote-debugging/), [WebXR controller mapping](https://www.w3.org/TR/webxr-gamepads-module-1/), [Quest Touch profile](https://github.com/immersive-web/webxr-input-profiles/blob/main/packages/registry/profiles/oculus/oculus-touch-v3.json), [Espressif CameraWebServer](https://github.com/espressif/arduino-esp32/tree/master/libraries/ESP32/examples/Camera/CameraWebServer).
