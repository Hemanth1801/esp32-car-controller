#pragma once
#include <stdint.h>
#include <math.h>

// Pure state machine, shared by the firmware and native regression tests.
class SafetyCore {
 public:
  bool armed = false;
  float throttle = 0, steering = 0, steerOutput = 0;
  uint32_t revision = 1, lastSequence = 0;
  const bool outputEnabled;
  const bool steeringHoldEnabled;
  const bool commandTimeoutEnabled;

  explicit SafetyCore(bool enabled, bool holdSteering = false, bool commandTimeout = true)
      : outputEnabled(enabled), steeringHoldEnabled(holdSteering), commandTimeoutEnabled(commandTimeout) {}

  void stop() {
    armed = false;
    throttle = steering = steerOutput = 0;
    pulseLatched = false;
    ++revision;
  }

  bool arm(uint32_t now, bool neutral, bool nonceMatches) {
    if (armed || !neutral || !nonceMatches) return false;
    stop();
    armed = true;
    updated = now;
    lastSequence = 0;
    return true;
  }

  bool command(uint32_t now, float drive, float turn, uint32_t sequence, bool sessionMatches) {
    tick(now, true);
    if (!armed || !sessionMatches || sequence <= lastSequence || !isfinite(drive) ||
        !isfinite(turn) || fabsf(drive) > 1 || fabsf(turn) > 1) {
      stop();
      return false;
    }
    lastSequence = sequence;
    updated = now;
    throttle = drive;
    steering = turn;
    if (fabsf(turn) < .08f) {
      pulseLatched = false;
      steerOutput = 0;
    } else if (steeringHoldEnabled) {
      steerOutput = turn;
    } else {
      if (!pulseLatched) { pulseStarted = now; pulseLatched = true; }
      steerOutput = uint32_t(now - pulseStarted) < 250 ? turn : 0;
    }
    return true;
  }

  void tick(uint32_t now, bool wifiConnected) {
    if (armed && (!wifiConnected || (commandTimeoutEnabled && uint32_t(now - updated) >= 400))) stop();
    if (!steeringHoldEnabled && pulseLatched && uint32_t(now - pulseStarted) >= 250) steerOutput = 0;
  }

  float driveOutput() const { return armed && outputEnabled ? throttle : 0; }
  float turnOutput() const { return armed && outputEnabled ? steerOutput : 0; }

 private:
  uint32_t updated = 0, pulseStarted = 0;
  bool pulseLatched = false;
};
