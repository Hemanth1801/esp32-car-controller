#pragma once
// Shared Wi-Fi: configure_wifi.py generates WIFI_SSID, WIFI_PASSWORD and WIFI_HOSTNAME
// in ignored config.h, using the same token and current motor-enable setting.
// Without WIFI_SSID the firmware retains the optional hotspot mode below.
#define AP_SSID "ESP-Car"
#define AP_PASSWORD "REPLACE_WITH_A_RANDOM_HOTSPOT_PASSWORD"
#define CONTROL_TOKEN "REPLACE_WITH_THE_SAME_RANDOM_TOKEN_AS_RELAY"
// Enable only after motor voltage/current and wiring have been checked.
#define MOTOR_OUTPUT_ENABLED false
// Set true only for a spring-return motor intended to remain energized while turning.
#define STEERING_HOLD_ENABLED false
// false holds the last output without a command deadline. Wi-Fi loss and Stop still disarm.
#define COMMAND_TIMEOUT_ENABLED true
