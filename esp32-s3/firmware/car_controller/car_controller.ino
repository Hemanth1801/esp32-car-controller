#include <WiFi.h>
#include <WiFiUdp.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include <atomic>
#include "SafetyCore.h"
#include "L298NBridge.h"
#if __has_include("config.h")
#include "config.h"
#else
#include "config.example.h"
#endif
#ifndef CAMERA_ONLY_BUILD
#define CAMERA_ONLY_BUILD 0
#endif
#if CAMERA_ONLY_BUILD
#undef MOTOR_OUTPUT_ENABLED
#define MOTOR_OUTPUT_ENABLED false
#endif
#ifndef STEERING_HOLD_ENABLED
#define STEERING_HOLD_ENABLED false
#endif
#ifndef COMMAND_TIMEOUT_ENABLED
#define COMMAND_TIMEOUT_ENABLED true
#endif

#if !CONFIG_IDF_TARGET_ESP32S3
#error This package is for ESP32-S3 only. Use the original package for classic ESP32.
#endif
#include "S3Camera.h"

constexpr int DRIVE_A = 1, DRIVE_B = 14, STEER_A = 21, STEER_B = 47;
constexpr int DRIVE_EN = 41, STEER_EN = 42;
struct ArduinoMotorIO {
  static void direction(int pin, bool high) { digitalWrite(pin, high ? HIGH : LOW); }
  static void enable(int pin, uint32_t duty) {
    ledc_channel_t channel = pin == DRIVE_EN ? LEDC_CHANNEL_2 : LEDC_CHANNEL_3;
    // 256 holds EN high at full speed; the 8-bit counter otherwise tops at 255.
    ledc_set_duty(LEDC_LOW_SPEED_MODE, channel, duty == 255 ? 256 : duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, channel);
  }
  static void pauseMicros(uint32_t duration) { delayMicroseconds(duration); }
};
L298NBridge<ArduinoMotorIO> driveBridge(DRIVE_A, DRIVE_B, DRIVE_EN);
L298NBridge<ArduinoMotorIO> steerBridge(STEER_A, STEER_B, STEER_EN);
SafetyCore car(MOTOR_OUTPUT_ENABLED, STEERING_HOLD_ENABLED, COMMAND_TIMEOUT_ENABLED);
WebServer server(80);
SemaphoreHandle_t motorMutex;
String owner, session, bootId;
bool pwmReady = false;
std::atomic<bool> networkReady{false}, clientDisconnected{false};
#ifdef WIFI_SSID
WiFiUDP discovery;
bool servicesRunning = false;
#endif

bool networkAvailable() {
#ifdef WIFI_SSID
  return networkReady.load() && WiFi.status() == WL_CONNECTED;
#else
  return networkReady.load() && WiFi.softAPgetStationNum() > 0;
#endif
}

void networkTickLocked() {
  // Latch even a quick disconnect/reconnect so the old session cannot resume.
  if (clientDisconnected.exchange(false)) car.stop();
  car.tick(millis(), networkAvailable());
}

String randomId() {
  char text[33];
  snprintf(text, sizeof(text), "%08lx%08lx%08lx%08lx",
           (unsigned long)esp_random(), (unsigned long)esp_random(),
           (unsigned long)esp_random(), (unsigned long)esp_random());
  return String(text);
}

String nonceLocked() { return bootId + ":" + String(car.revision); }

void outputsLocked() {
  if (!pwmReady) return;
  driveBridge.apply(car.driveOutput());
  steerBridge.apply(car.turnOutput());
}

void motorTask(void*) {
  // Independent of WebServer: a slow/half-open HTTP connection cannot hold drive on.
  for (;;) {
    xSemaphoreTake(motorMutex, portMAX_DELAY);
    networkTickLocked();
    outputsLocked();
    xSemaphoreGive(motorMutex);
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

void statusResponse() {
  JsonDocument doc;
  xSemaphoreTake(motorMutex, portMAX_DELAY);
  networkTickLocked();
  doc["armed"] = car.armed;
  doc["arm_nonce"] = nonceLocked();
  doc["session"] = car.armed ? session : String("");
  doc["throttle"] = car.throttle;
  doc["steering"] = car.steering;
  doc["drive_output"] = car.driveOutput();
  doc["steering_output"] = car.turnOutput();
  doc["output_enabled"] = MOTOR_OUTPUT_ENABLED && pwmReady;
  doc["steering_mode"] = STEERING_HOLD_ENABLED ? "hold" : "pulse";
  doc["command_timeout_enabled"] = COMMAND_TIMEOUT_ENABLED;
  doc["command_timeout_ms"] = COMMAND_TIMEOUT_ENABLED ? 400 : 0;
#ifdef WIFI_SSID
  doc["network_mode"] = "wifi";
  doc["wifi_ssid"] = WIFI_SSID;
  doc["ip"] = WiFi.localIP().toString();
#else
  doc["network_mode"] = "hotspot";
  doc["hotspot_ssid"] = AP_SSID;
#endif
  doc["driver"] = "L298N";
  doc["board"] = "esp32-s3-n16r8";
  doc["device_role"] = CAMERA_ONLY_BUILD ? "camera-only" : "car";
  doc["psram_bytes"] = ESP.getPsramSize();
  JsonObject video = doc["camera"].to<JsonObject>();
  video["ready"] = cameraReady && cameraServer != nullptr;
  video["sensor_ready"] = cameraReady; video["sensor_pid"] = cameraSensor;
  video["init_error_code"] = cameraInitError;
  video["init_error_name"] = esp_err_to_name(cameraInitError);
  video["sensor"] = cameraSensor == 0x3660 ? "OV3660" : "unverified";
  video["width"] = 640; video["height"] = 480; video["fps_limit"] = 10;
  video["port"] = 81; video["path"] = "/stream"; video["message"] = cameraError;
  doc["mode"] = MOTOR_OUTPUT_ENABLED && pwmReady ? "motors" : "dry-run";
  String message = !pwmReady ? "PWM setup failed; motor outputs disabled" :
      MOTOR_OUTPUT_ENABLED ? (STEERING_HOLD_ENABLED ? "L298N motor output enabled; steering hold mode" :
                             "L298N motor output enabled; steering pulses limited to 250 ms") :
      "DRY RUN: motor output disabled in firmware";
  if (!COMMAND_TIMEOUT_ENABLED) message += "; 400 ms command timeout OFF";
  if (CAMERA_ONLY_BUILD) { message = "Camera-only S3: motor outputs disabled"; doc["mode"] = "camera-only"; }
  doc["message"] = message;
  xSemaphoreGive(motorMutex);
  String body;
  serializeJson(doc, body);
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", body);
}

void reject(int code, const char* message, bool stop = false) {
  if (stop) {
    xSemaphoreTake(motorMutex, portMAX_DELAY);
    car.stop(); outputsLocked();
    xSemaphoreGive(motorMutex);
  }
  JsonDocument doc;
  doc["error"] = message;
  String body;
  serializeJson(doc, body);
  server.send(code, "application/json", body);
}

bool authorized() {
  if (strlen(CONTROL_TOKEN) < 24 || String(CONTROL_TOKEN).startsWith("REPLACE_") ||
      server.header("X-Control-Token") != CONTROL_TOKEN) {
    reject(401, "Pairing token required");
    return false;
  }
  return true;
}

void command(const String& action) {
  if (!authorized()) return;
  if (CAMERA_ONLY_BUILD && (action == "arm" || action == "control")) {
    reject(409, "Camera-only S3 does not accept motor commands"); return;
  }
  // Stop is unconditional for an authenticated controller, including stale tabs.
  if (action == "stop") {
    xSemaphoreTake(motorMutex, portMAX_DELAY);
    car.stop(); outputsLocked();
    xSemaphoreGive(motorMutex);
    statusResponse(); return;
  }
  if (server.arg("plain").length() > 2048) { reject(400, "Request too large", true); return; }
  JsonDocument doc;
  if (deserializeJson(doc, server.arg("plain")) || !doc.is<JsonObject>()) {
    reject(400, "Invalid JSON", true); return;
  }
  if (!doc["owner"].is<const char*>() || !doc["throttle"].is<float>() ||
      !doc["steering"].is<float>()) { reject(400, "Invalid command", true); return; }
  String requestOwner = doc["owner"].as<String>();
  float throttle = doc["throttle"], steering = doc["steering"];
  if (requestOwner.length() == 0 || requestOwner.length() > 100 || !isfinite(throttle) ||
      !isfinite(steering) || fabsf(throttle) > 1 || fabsf(steering) > 1) {
    reject(400, "Invalid input", true); return;
  }
  xSemaphoreTake(motorMutex, portMAX_DELAY);
  networkTickLocked();
  bool ok = false;
  if (action == "arm") {
    bool neutral = doc["neutral"].is<bool>() && doc["neutral"].as<bool>() &&
                   fabsf(throttle) <= .05f && fabsf(steering) <= .05f;
    bool nonceMatches = doc["arm_nonce"].is<const char*>() && doc["arm_nonce"].as<String>() == nonceLocked();
    ok = pwmReady && networkAvailable() && car.arm(millis(), neutral, nonceMatches);
    if (ok) { owner = requestOwner; session = randomId(); }
  } else {
    bool matches = requestOwner == owner && doc["session"].is<const char*>() &&
                   doc["session"].as<String>() == session;
    bool sequenceValid = doc["seq"].is<uint32_t>() && doc["seq"].as<uint32_t>() > 0;
    ok = car.command(millis(), throttle, steering, sequenceValid ? doc["seq"].as<uint32_t>() : 0, matches);
  }
  outputsLocked();
  xSemaphoreGive(motorMutex);
  if (!ok) reject(409, "Disarmed, expired session, stale sequence, or non-neutral arm");
  else statusResponse();
}

void setup() {
  Serial.begin(115200);
  for (int pin : {DRIVE_EN, STEER_EN, DRIVE_A, DRIVE_B, STEER_A, STEER_B}) {
    pinMode(pin, OUTPUT); digitalWrite(pin, LOW);
  }
  motorMutex = xSemaphoreCreateMutex();
  if (!motorMutex) { Serial.println("Motor mutex failed; outputs remain LOW"); for (;;) delay(1000); }
  pwmReady = setupMotorPWM(DRIVE_EN, STEER_EN);
  if (!pwmReady) {
    for (int pin : {DRIVE_EN, STEER_EN}) {
      ledc_stop(LEDC_LOW_SPEED_MODE, pin == DRIVE_EN ? LEDC_CHANNEL_2 : LEDC_CHANNEL_3, 0);
      pinMode(pin, OUTPUT); digitalWrite(pin, LOW);
    }
  }
  bootId = randomId();
  WiFi.onEvent([](WiFiEvent_t event) {
    // Wi-Fi callbacks run on another task. Only atomics are touched here.
#ifdef WIFI_SSID
    if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) networkReady.store(true);
    else if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED || event == ARDUINO_EVENT_WIFI_STA_LOST_IP ||
             event == ARDUINO_EVENT_WIFI_STA_STOP) {
      networkReady.store(false);
      clientDisconnected.store(true);
    }
#else
    if (event == ARDUINO_EVENT_WIFI_AP_STOP) {
      networkReady.store(false);
      clientDisconnected.store(true);
    } else if (event == ARDUINO_EVENT_WIFI_AP_STADISCONNECTED) {
      clientDisconnected.store(true);
    }
#endif
  });
  if (xTaskCreate(motorTask, "motor-watchdog", 4096, nullptr, 3, nullptr) != pdPASS) {
    for (int pin : {DRIVE_EN, STEER_EN}) ArduinoMotorIO::enable(pin, 0);
    Serial.println("Watchdog task failed; halted"); for (;;) delay(1000);
  }
  cameraReady = startCamera();
  Serial.println(cameraReady ? "Onboard camera ready" : cameraError);
  Serial.println("Motor PWM: timer 1, channels 2/3; camera timer 0, channel 0");
  const char* headers[] = {"X-Control-Token"};
  server.collectHeaders(headers, 1);
  server.on("/api/status", HTTP_GET, [] { if (authorized()) statusResponse(); });
  server.on("/api/heartbeat", HTTP_POST, [] { if (authorized()) statusResponse(); });
  server.on("/api/arm", HTTP_POST, [] { command("arm"); });
  server.on("/api/control", HTTP_POST, [] { command("control"); });
  server.on("/api/stop", HTTP_POST, [] { command("stop"); });
  server.onNotFound([] { server.send(404, "application/json", "{\"error\":\"No site hosted on ESP\"}"); });
#ifdef WIFI_SSID
  if (strlen(WIFI_SSID) == 0 || strlen(WIFI_SSID) > 32 || strlen(WIFI_PASSWORD) < 8 ||
      strlen(WIFI_PASSWORD) > 63 || strlen(CONTROL_TOKEN) < 24 ||
      String(WIFI_SSID).startsWith("REPLACE_") || String(CONTROL_TOKEN).startsWith("REPLACE_")) {
    Serial.println("Shared Wi-Fi configuration missing/invalid; outputs remain disarmed.");
    for (;;) delay(1000);
  }
  WiFi.persistent(false);
  WiFi.setHostname(WIFI_HOSTNAME);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Joining shared Wi-Fi: "); Serial.println(WIFI_SSID);
  // Connection happens asynchronously; the independent watchdog is already running.
#else
  WiFi.mode(WIFI_AP);
  WiFi.setSleep(false);
  if (strlen(AP_SSID) == 0 || strlen(AP_SSID) > 32 || strlen(AP_PASSWORD) < 8 ||
      strlen(AP_PASSWORD) > 63 || strlen(CONTROL_TOKEN) < 24 ||
      String(CONTROL_TOKEN).startsWith("REPLACE_")) {
    Serial.println("Hotspot configuration missing/invalid. Run python setup.py and upload again.");
    for (;;) delay(1000);
  }
  IPAddress ip(192, 168, 4, 1), subnet(255, 255, 255, 0);
  bool configured = WiFi.softAPConfig(ip, ip, subnet);
  // Computer relay + phone controller. The site itself remains on the computer.
  bool started = configured && WiFi.softAP(AP_SSID, AP_PASSWORD, 1, false, 2);
  networkReady.store(started);
  if (!started) {
    Serial.println("Hotspot startup failed; outputs remain disarmed.");
    for (;;) delay(1000);
  }
  server.begin();
  Serial.print("Hotspot ready: "); Serial.println(AP_SSID);
  Serial.print("ESP address: "); Serial.println(WiFi.softAPIP());
  Serial.println("Connect this computer to the hotspot, then open http://localhost:8765");
#endif
  Serial.println(MOTOR_OUTPUT_ENABLED ? "Motor mode; press Arm on the PC" : "DRY RUN; motor output disabled");
  Serial.println(COMMAND_TIMEOUT_ENABLED ? "Command timeout: 400 ms" : "Command timeout: OFF; last output can persist without commands");
}

void loop() {
#ifdef WIFI_SSID
  bool connected = networkAvailable();
  if (connected && !servicesRunning) {
    server.begin();
    // Do not create HTTP sockets until Wi-Fi has initialized the TCP/IP stack.
    if (cameraReady) startCameraServer();
    discovery.begin(8769);
    if (MDNS.begin(WIFI_HOSTNAME)) MDNS.addService("esp-car", "tcp", 80);
    servicesRunning = true;
    Serial.print("Shared Wi-Fi ready: "); Serial.println(WIFI_SSID);
    Serial.print("ESP address: "); Serial.println(WiFi.localIP());
    Serial.println("Connect computer and phone to this Wi-Fi, then run start-mobile.cmd");
  } else if (!connected && servicesRunning) {
    server.stop(); discovery.stop(); MDNS.end();
    servicesRunning = false;
    Serial.println("Wi-Fi lost; stopped and disarmed. Waiting to reconnect.");
  }
  if (connected) {
    static uint32_t cameraServerRetry = 0;
    if (cameraReady && !cameraServer && uint32_t(millis() - cameraServerRetry) >= 5000) {
      cameraServerRetry = millis();
      startCameraServer();
    }
    // Discovery only returns a nonce, never credentials and never motor commands.
    int size = discovery.parsePacket();
    if (size > 0) {
      char request[96] = {};
      const char* prefix = "ESP-CAR-DISCOVER/1 ";
      if (size == int(strlen(prefix) + 32) && size < int(sizeof(request))) {
        int count = discovery.read(request, size);
        bool valid = count == size && strncmp(request, prefix, strlen(prefix)) == 0;
        for (int i = strlen(prefix); valid && i < size; ++i) {
          valid = (request[i] >= '0' && request[i] <= '9') || (request[i] >= 'a' && request[i] <= 'f');
        }
        if (valid) {
          discovery.beginPacket(discovery.remoteIP(), discovery.remotePort());
          discovery.print("ESP-CAR/1 "); discovery.print(request + strlen(prefix));
          discovery.endPacket();
        }
      } else discovery.clear();
    }
    server.handleClient();
  }
#else
  if (networkReady.load()) server.handleClient();
#endif
  delay(1);
}
