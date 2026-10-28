#pragma once
// S3-only shared Wi-Fi example. The configured local build uses ignored config.h.
#define WIFI_SSID "REPLACE_WITH_YOUR_2_4_GHZ_SSID"
#define WIFI_PASSWORD "REPLACE_WITH_WIFI_PASSWORD"
#define WIFI_HOSTNAME "esp-car-s3"
#define CONTROL_TOKEN "REPLACE_WITH_THE_SAME_RANDOM_TOKEN_AS_RELAY"
// Enable only after motor voltage/current and wiring have been checked.
#define MOTOR_OUTPUT_ENABLED false
// Set true only for a spring-return motor intended to remain energized while turning.
#define STEERING_HOLD_ENABLED false
// false holds the last output without a command deadline. Wi-Fi loss and Stop still disarm.
#define COMMAND_TIMEOUT_ENABLED true
