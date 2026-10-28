#include "../firmware/car_controller/SafetyCore.h"
#include "../firmware/car_controller/L298NBridge.h"
#include <assert.h>
#include <iostream>
#include <limits>

struct MockMotorIO {
  inline static bool pins[64] = {};
  inline static uint32_t duty[64] = {};
  inline static uint32_t lastPause = 0;
  static void direction(int pin, bool high) {
    int enablePin = pin == 25 || pin == 26 ? 32 : 33;
    if (pins[pin] != high) assert(duty[enablePin] == 0);
    pins[pin] = high;
  }
  static void enable(int pin, uint32_t value) {
    assert(value <= 255);
    if (value) {
      int a = pin == 32 ? 25 : 27, b = pin == 32 ? 26 : 14;
      assert(pins[a] != pins[b]);
    }
    duty[pin] = value;
  }
  static void pauseMicros(uint32_t value) { lastPause = value; }
};

int main() {
  L298NBridge<MockMotorIO> drive(25, 26, 32), turn(27, 14, 33);
  drive.apply(1);
  assert(MockMotorIO::duty[32] == 255 && MockMotorIO::pins[25] && !MockMotorIO::pins[26]);
  drive.apply(-1);
  assert(MockMotorIO::duty[32] == 255 && !MockMotorIO::pins[25] && MockMotorIO::pins[26]);
  assert(MockMotorIO::lastPause >= 10);
  turn.apply(.5f);
  assert(MockMotorIO::duty[33] == 128 && MockMotorIO::pins[27] && !MockMotorIO::pins[14]);
  drive.apply(0); turn.apply(0);
  assert(MockMotorIO::duty[32] == 0 && MockMotorIO::duty[33] == 0);
  drive.apply(std::numeric_limits<float>::quiet_NaN());
  assert(MockMotorIO::duty[32] == 0);
  SafetyCore disabled(false);
  assert(!disabled.armed && disabled.driveOutput() == 0);
  assert(disabled.arm(0, true, true));
  assert(disabled.command(0, .8f, .4f, 1, true));
  assert(disabled.driveOutput() == 0 && disabled.turnOutput() == 0);

  SafetyCore car(true);
  assert(!car.arm(0, false, true));
  assert(!car.arm(0, true, false));
  assert(car.arm(0, true, true));
  assert(!car.arm(0, true, true));
  assert(car.command(0, .6f, .5f, 1, true));
  assert(car.driveOutput() == .6f && car.turnOutput() == .5f);
  car.tick(249, true); assert(car.turnOutput() == .5f);
  car.tick(250, true); assert(car.turnOutput() == 0);
  assert(car.command(251, .6f, -.5f, 2, true));
  assert(car.turnOutput() == 0); // Reversing without neutral cannot restart a pulse.
  assert(car.command(252, 0, 0, 3, true));
  assert(car.command(253, -.5f, -.8f, 4, true));
  assert(car.turnOutput() == -.8f && car.driveOutput() == -.5f);
  car.tick(652, true); assert(car.armed);
  const auto revision = car.revision;
  car.tick(653, true); assert(!car.armed && car.revision != revision);
  assert(car.driveOutput() == 0 && car.turnOutput() == 0);
  assert(!car.command(654, 1, 1, 5, true)); // No auto-rearm after timeout.

  assert(car.arm(700, true, true));
  assert(car.command(701, .5f, .5f, 1, true));
  assert(!car.command(702, .5f, .5f, 1, true)); // Duplicate sequence disarms.
  assert(!car.armed);
  assert(car.arm(703, true, true));
  assert(!car.command(704, .5f, .5f, 2, false)); // Wrong session/owner.
  assert(!car.armed);
  assert(car.arm(705, true, true));
  assert(!car.command(706, std::numeric_limits<float>::quiet_NaN(), 0, 1, true));
  assert(car.arm(707, true, true));
  assert(!car.command(708, 0, std::numeric_limits<float>::infinity(), 1, true));
  assert(car.arm(709, true, true));
  assert(!car.command(710, 1.1f, 0, 1, true));
  assert(car.arm(711, true, true));
  car.tick(712, false); assert(!car.armed && car.driveOutput() == 0);

  const uint32_t nearWrap = UINT32_MAX - 100;
  assert(car.arm(nearWrap, true, true));
  assert(car.command(nearWrap, 1, 1, 1, true));
  assert(car.driveOutput() == 1 && car.turnOutput() == 1);
  car.tick(nearWrap + uint32_t(250), true); assert(car.turnOutput() == 0);
  car.tick(nearWrap + uint32_t(399), true); assert(car.armed);
  car.tick(nearWrap + uint32_t(400), true); assert(!car.armed);
  SafetyCore hold(true, true);
  assert(hold.arm(0, true, true));
  for (uint32_t now = 0; now <= 2000; now += 50) {
    assert(hold.command(now, 0, .7f, now / 50 + 1, true));
    hold.tick(now + 49, true);
    assert(hold.armed && hold.turnOutput() == .7f);
  }
  assert(hold.command(2050, 0, 0, 42, true));
  assert(hold.turnOutput() == 0 && hold.armed); // Centre releases the spring.
  assert(hold.command(2100, 0, -1, 43, true));
  assert(hold.turnOutput() == -1); // New direction is held at requested PWM.
  hold.tick(2499, true); assert(hold.armed && hold.turnOutput() == -1);
  hold.tick(2500, true); assert(!hold.armed && hold.turnOutput() == 0);
  assert(!hold.command(2501, 0, -1, 44, true));
  assert(hold.arm(2600, true, true));
  assert(hold.command(2600, 0, 1, 1, true));
  hold.tick(2601, false); assert(!hold.armed && hold.turnOutput() == 0);
  assert(hold.arm(2700, true, true));
  assert(hold.command(2700, 0, 1, 1, true));
  hold.stop(); assert(!hold.armed && hold.turnOutput() == 0);
  SafetyCore holdDisabled(false, true);
  assert(holdDisabled.arm(0, true, true));
  assert(holdDisabled.command(0, 0, 1, 1, true));
  assert(holdDisabled.turnOutput() == 0);
  SafetyCore timeoutOff(true, true, false);
  assert(!timeoutOff.armed && timeoutOff.driveOutput() == 0);
  assert(timeoutOff.arm(0, true, true));
  assert(timeoutOff.command(0, .6f, -.4f, 1, true));
  timeoutOff.tick(400, true);
  timeoutOff.tick(60000, true);
  assert(timeoutOff.armed && timeoutOff.driveOutput() == .6f && timeoutOff.turnOutput() == -.4f);
  assert(timeoutOff.command(60001, 0, 0, 2, true));
  assert(timeoutOff.armed && timeoutOff.driveOutput() == 0 && timeoutOff.turnOutput() == 0);
  timeoutOff.tick(60002, false); assert(!timeoutOff.armed); // Wi-Fi stop remains independent.
  assert(timeoutOff.arm(61000, true, true));
  assert(timeoutOff.command(61000, 1, 1, 1, true));
  timeoutOff.stop(); assert(!timeoutOff.armed && timeoutOff.driveOutput() == 0);
  assert(timeoutOff.arm(62000, true, true));
  assert(timeoutOff.command(62000, 1, 1, 1, true));
  assert(!timeoutOff.command(63000, 1, 1, 1, true)); // Stale sequence still disarms.
  assert(timeoutOff.arm(64000, true, true));
  assert(!timeoutOff.command(64000, 1, 1, 1, false)); // Wrong session still disarms.
  SafetyCore pulseWithoutTimeout(true, false, false);
  assert(pulseWithoutTimeout.arm(0, true, true));
  assert(pulseWithoutTimeout.command(0, .6f, 1, 1, true));
  pulseWithoutTimeout.tick(1000, true);
  assert(pulseWithoutTimeout.armed && pulseWithoutTimeout.driveOutput() == .6f && pulseWithoutTimeout.turnOutput() == 0);
  std::cout << "L298N PWM/direction/full-speed and SafetyCore enabled/disabled timeout, session, pulse and hold tests passed.\n";
}
