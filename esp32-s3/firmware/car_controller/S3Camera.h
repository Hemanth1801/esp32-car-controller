#pragma once
#include <esp_camera.h>
#include <esp_http_server.h>
#include <driver/ledc.h>
#include <esp_err.h>

// The photographed dual-USB board is expected to use the S3-EYE DVP profile.
// Verify the sensor and a JPEG before connecting motor power.
static bool cameraReady = false;
static uint16_t cameraSensor = 0;
static const char* cameraError = "Camera not initialized";
static esp_err_t cameraInitError = ESP_OK;
static char cameraErrorDetail[160] = {};
static httpd_handle_t cameraServer = nullptr;

static esp_err_t streamFrames(httpd_req_t* request) {
  char token[160] = {};
  size_t length = httpd_req_get_hdr_value_len(request, "X-Control-Token");
  if (length >= sizeof(token) || length < 24 ||
      httpd_req_get_hdr_value_str(request, "X-Control-Token", token, sizeof(token)) != ESP_OK ||
      strcmp(token, CONTROL_TOKEN) != 0) {
    httpd_resp_set_status(request, "401 Unauthorized");
    return httpd_resp_send(request, "Pairing token required", HTTPD_RESP_USE_STRLEN);
  }
  httpd_resp_set_type(request, "multipart/x-mixed-replace;boundary=s3-car-frame");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  while (WiFi.status() == WL_CONNECTED) {
    TickType_t began = xTaskGetTickCount();
    camera_fb_t* frame = esp_camera_fb_get();
    if (!frame) return ESP_FAIL;
    esp_err_t result = ESP_FAIL;
    if (frame->format == PIXFORMAT_JPEG && frame->len <= 192 * 1024 && frame->len >= 4) {
      char header[192];
      int count = snprintf(header, sizeof(header),
          "\r\n--s3-car-frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\nX-Timestamp: %lu.%06lu\r\n\r\n",
          unsigned(frame->len), (unsigned long)frame->timestamp.tv_sec, (unsigned long)frame->timestamp.tv_usec);
      result = httpd_resp_send_chunk(request, header, count);
      if (result == ESP_OK) result = httpd_resp_send_chunk(request, (const char*)frame->buf, frame->len);
    }
    esp_camera_fb_return(frame);
    if (result != ESP_OK) return result;
    TickType_t elapsed = xTaskGetTickCount() - began;
    if (elapsed < pdMS_TO_TICKS(100)) vTaskDelay(pdMS_TO_TICKS(100) - elapsed);
  }
  return ESP_FAIL;
}

static bool startCamera() {
  if (!psramFound()) { cameraError = "PSRAM unavailable: select OPI PSRAM"; return false; }
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0; config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = 11; config.pin_d1 = 9; config.pin_d2 = 8; config.pin_d3 = 10;
  config.pin_d4 = 12; config.pin_d5 = 18; config.pin_d6 = 17; config.pin_d7 = 16;
  config.pin_xclk = 15; config.pin_pclk = 13; config.pin_vsync = 6; config.pin_href = 7;
  config.pin_sccb_sda = 4; config.pin_sccb_scl = 5; config.pin_pwdn = -1; config.pin_reset = -1;
  config.xclk_freq_hz = 20000000; config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_VGA; config.jpeg_quality = 16;
  config.fb_count = 2; config.fb_location = CAMERA_FB_IN_PSRAM; config.grab_mode = CAMERA_GRAB_LATEST;
  cameraInitError = esp_camera_init(&config);
  if (cameraInitError != ESP_OK) {
    snprintf(cameraErrorDetail, sizeof(cameraErrorDetail), "Camera init failed: %s (0x%x); verify ribbon and S3-EYE pin profile",
        esp_err_to_name(cameraInitError), unsigned(cameraInitError));
    cameraError = cameraErrorDetail;
    Serial.println(cameraError);
    return false;
  }
  sensor_t* sensor = esp_camera_sensor_get();
  cameraSensor = sensor ? sensor->id.PID : 0;
  camera_fb_t* frame = esp_camera_fb_get();
  bool valid = frame && frame->format == PIXFORMAT_JPEG && frame->len >= 4 &&
      frame->buf[0] == 0xff && frame->buf[1] == 0xd8 && frame->buf[frame->len - 2] == 0xff && frame->buf[frame->len - 1] == 0xd9;
  if (frame) esp_camera_fb_return(frame);
  if (!valid) { cameraError = "Camera did not produce a valid JPEG"; esp_camera_deinit(); return false; }
  cameraError = "";
  Serial.printf("Camera JPEG verified; sensor PID=0x%04x; PSRAM=%u bytes\n", cameraSensor, unsigned(ESP.getPsramSize()));
  return true;
}

// Networking is initialized asynchronously by Wi-Fi. Creating sockets during
// sensor setup (before WiFi.mode/begin) panics in lwIP's uninitialized mutex.
// Invoke only from loop() after the station has obtained an IP address.
static bool startCameraServer() {
  if (!cameraReady) return false;
  if (cameraServer) return true;
  httpd_config_t http = HTTPD_DEFAULT_CONFIG();
  http.server_port = 81; http.ctrl_port = 32769;
  http.task_priority = 1; http.max_open_sockets = 2; http.lru_purge_enable = true;
  http.send_wait_timeout = 1; http.recv_wait_timeout = 1; http.stack_size = 6144;
  if (httpd_start(&cameraServer, &http) != ESP_OK) { cameraError = "Camera server failed"; return false; }
  httpd_uri_t stream = {};
  stream.uri = "/stream"; stream.method = HTTP_GET; stream.handler = streamFrames;
  if (httpd_register_uri_handler(cameraServer, &stream) != ESP_OK) {
    httpd_stop(cameraServer); cameraServer = nullptr; cameraError = "Camera route failed"; return false;
  }
  cameraError = "";
  Serial.println("Camera stream server ready on port 81");
  return true;
}

static bool setupMotorPWM(int drivePin, int steerPin) {
  // Do not use Arduino's automatic LEDC timer allocator alongside esp_camera.
  ledc_timer_config_t timer = {};
  timer.speed_mode = LEDC_LOW_SPEED_MODE; timer.duty_resolution = LEDC_TIMER_8_BIT;
  timer.timer_num = LEDC_TIMER_1; timer.freq_hz = 20000; timer.clk_cfg = LEDC_AUTO_CLK;
  if (ledc_timer_config(&timer) != ESP_OK) return false;
  for (int index = 0; index < 2; ++index) {
    ledc_channel_config_t channel = {};
    channel.gpio_num = index == 0 ? drivePin : steerPin;
    channel.speed_mode = LEDC_LOW_SPEED_MODE;
    channel.channel = index == 0 ? LEDC_CHANNEL_2 : LEDC_CHANNEL_3;
    channel.timer_sel = LEDC_TIMER_1; channel.duty = 0;
    if (ledc_channel_config(&channel) != ESP_OK) return false;
  }
  return true;
}
