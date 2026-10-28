// Local camera companion for a SEPARATE AI Thinker ESP32-CAM / OV2640.
// Camera pin assignments follow Espressif's CameraWebServer AI Thinker profile.
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <ArduinoJson.h>
#include <esp_camera.h>
#include <esp_http_server.h>
#include <mbedtls/md.h>
#include "config.h"

static WiFiUDP discovery;
static httpd_handle_t cameraServer = nullptr;
static String cameraId;
static bool cameraReady = false, udpReady = false;
static constexpr uint16_t DISCOVERY_PORT = 8770;
static constexpr char REQUEST_PREFIX[] = "ESP-CAR-CAMERA/1 ";
static constexpr char BOUNDARY[] = "esp-car-camera-frame";

static String signNonce(const String &nonce) {
  const String payload = nonce + "\n" + cameraId + "\n" + WiFi.localIP().toString() + "\n81\n/stream";
  uint8_t digest[32];
  const auto *md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (!md || mbedtls_md_hmac(md, reinterpret_cast<const uint8_t *>(CAMERA_PAIR_KEY), strlen(CAMERA_PAIR_KEY),
      reinterpret_cast<const uint8_t *>(payload.c_str()), payload.length(), digest) != 0) return "";
  char hex[65];
  for (size_t i = 0; i < 32; i++) snprintf(hex + i * 2, 3, "%02x", digest[i]);
  return String(hex);
}

static esp_err_t streamFrames(httpd_req_t *request) {
  if (httpd_resp_set_type(request, "multipart/x-mixed-replace;boundary=esp-car-camera-frame") != ESP_OK) return ESP_FAIL;
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  while (WiFi.status() == WL_CONNECTED) {
    camera_fb_t *frame = esp_camera_fb_get();
    if (!frame) return ESP_FAIL;
    esp_err_t result = ESP_FAIL;
    if (frame->format == PIXFORMAT_JPEG && frame->len <= 192 * 1024) {
      char header[192];
      int length = snprintf(header, sizeof(header), "\r\n--%s\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\nX-Timestamp: %lu.%06lu\r\n\r\n",
        BOUNDARY, static_cast<unsigned>(frame->len), static_cast<unsigned long>(frame->timestamp.tv_sec), static_cast<unsigned long>(frame->timestamp.tv_usec));
      result = httpd_resp_send_chunk(request, header, length);
      if (result == ESP_OK) result = httpd_resp_send_chunk(request, reinterpret_cast<const char *>(frame->buf), frame->len);
    }
    esp_camera_fb_return(frame);
    if (result != ESP_OK) return result;
    vTaskDelay(pdMS_TO_TICKS(80));
  }
  return ESP_FAIL;
}

static bool startCamera() {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = 5; config.pin_d1 = 18; config.pin_d2 = 19; config.pin_d3 = 21;
  config.pin_d4 = 36; config.pin_d5 = 39; config.pin_d6 = 34; config.pin_d7 = 35;
  config.pin_xclk = 0; config.pin_pclk = 22; config.pin_vsync = 25; config.pin_href = 23;
  config.pin_sccb_sda = 26; config.pin_sccb_scl = 27; config.pin_pwdn = 32; config.pin_reset = -1;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = psramFound() ? FRAMESIZE_VGA : FRAMESIZE_QVGA;
  config.jpeg_quality = 16;
  config.fb_count = psramFound() ? 2 : 1;
  config.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  config.grab_mode = CAMERA_GRAB_LATEST;
  if (esp_camera_init(&config) != ESP_OK) { Serial.println("Camera init failed: check AI Thinker / OV2640 model and ribbon."); return false; }
  httpd_config_t http = HTTPD_DEFAULT_CONFIG();
  http.server_port = 81;
  http.max_open_sockets = 2;
  http.send_wait_timeout = 1;
  if (httpd_start(&cameraServer, &http) != ESP_OK) return false;
  httpd_uri_t stream = {};
  stream.uri = "/stream"; stream.method = HTTP_GET; stream.handler = streamFrames;
  return httpd_register_uri_handler(cameraServer, &stream) == ESP_OK;
}

void setup() {
  Serial.begin(115200);
  if (strlen(CAMERA_PAIR_KEY) != 64 || String(CAMERA_WIFI_SSID).startsWith("REPLACE_")) {
    Serial.println("Run prepare_camera.py before building; camera not configured.");
    return;
  }
  WiFi.mode(WIFI_STA);
  cameraId = WiFi.macAddress(); cameraId.replace(":", ""); cameraId.toLowerCase();
  WiFi.setHostname("esp-car-camera");
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(CAMERA_WIFI_SSID, CAMERA_WIFI_PASSWORD);
  cameraReady = startCamera();
  Serial.println(cameraReady ? "Camera companion ready; joining configured shared Wi-Fi." : "Camera unavailable; discovery disabled.");
}

void loop() {
  static uint32_t lastRetry = 0;
  if (!cameraReady) { delay(100); return; }
  if (WiFi.status() != WL_CONNECTED) {
    if (udpReady) { discovery.stop(); udpReady = false; }
    if (millis() - lastRetry > 10000) { lastRetry = millis(); WiFi.reconnect(); }
    delay(20); return;
  }
  if (!udpReady) {
    udpReady = discovery.begin(DISCOVERY_PORT);
    Serial.printf("Camera Wi-Fi ready: http://%s:81/stream\n", WiFi.localIP().toString().c_str());
  }
  int size = discovery.parsePacket();
  if (size > 0) {
    char buffer[96];
    int length = discovery.read(buffer, sizeof(buffer) - 1);
    if (length > 0 && size == length) {
      buffer[length] = 0;
      String input(buffer);
      String nonce = input.substring(strlen(REQUEST_PREFIX));
      bool valid = input.startsWith(REQUEST_PREFIX) && nonce.length() == 32;
      for (size_t i = 0; valid && i < nonce.length(); i++) valid = isxdigit(nonce[i]);
      if (valid) {
        JsonDocument reply;
        reply["nonce"] = nonce; reply["id"] = cameraId; reply["port"] = 81;
        reply["path"] = "/stream"; reply["signature"] = signNonce(nonce);
        String payload; serializeJson(reply, payload);
        discovery.beginPacket(discovery.remoteIP(), discovery.remotePort());
        discovery.write(reinterpret_cast<const uint8_t *>(payload.c_str()), payload.length());
        discovery.endPacket();
      }
    }
  }
  delay(5);
}
