# S3 racing cockpit

Camera orientation: the reported upside-down mounting now defaults to a **180-degree rotation** in the desktop preview and live VR windshield. Reload the page to apply it. Use **Camera orientation** under Onboard S3 camera to select Normal, Rotate 180 degrees, Flip top/bottom, or Mirror left/right. The selection is saved per browser/origin; it affects video only. Changing it disarms that page. Select Normal for an upright replacement/phone camera. No firmware upload is needed.

The GT cabin now uses a curved padded dashboard, stitched leather wheel and trim, fine carbon weave, brushed-metal vents and switchgear, smoked side glass and view-dependent material lighting. The windshield retains the real front camera feed; the mirror and side glass are decorative surfaces, not additional camera feeds. Instrument values remain requested drive/steering, not measured speed or RPM.

Reload the Quest page to load the new cabin; no firmware upload is needed. Preview image: [GT cockpit](artifacts/quest-gt-cockpit.png). Static cabin and steering geometry are grouped into 33 material draws per eye, with about 81,000 triangles before the display/video planes. Browser checks cover preview and synthetic stereo rendering; performance on the physical Quest 2 still needs verification.

For the configured **old ESP32 motors + S3 camera** setup, run `start-dual.cmd` or select option 3 in `..\choose-controller.cmd`, followed by Quest. Open **https://192.168.1.11:8867/quest**. Live video comes from the S3; Arm and driving commands go to the old ESP32. See [TWO-BOARD.md](TWO-BOARD.md). The single-S3 launcher below is for the alternative combined motor/camera firmware.

Run `start-quest.cmd` in this folder, or choose New ESP32-S3 → Quest in the parent `choose-controller.cmd`.

Use the printed **https://COMPUTER-IP:8867/quest** address in Quest Browser. The headset must trust this S3 package's local CA; certificate setup is **http://COMPUTER-IP:8868**. The computer stays on the same LAN as the ESP and headset.

The existing racing interior is preserved: racing wheel, carbon dash, roll cage, seat and live-view windshield. Practice starts without operating motors. The S3 onboard camera attaches automatically after authenticated discovery. Select Live car explicitly when ready. A arms at neutral; right grip enables movement; left stick steers; right/left triggers request forward/reverse; B stops. Video/tracking/visibility loss stops and disarms Live. Reconnection does not arm.

Manual JPEG/MJPEG cameras and the phone uplink remain available. Disconnect the onboard source first to give the phone camera publishing ownership. Return to onboard with **Use paired S3 onboard camera**.

Physical Quest2 WebXR, trust installation, sensor latency and car operation remain to be verified with the real hardware. Browser tests use simulated XR inputs and camera frames.
