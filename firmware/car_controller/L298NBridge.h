#pragma once
#include <math.h>
#include <stdint.h>

// IO supplies direction(pin, high), enable(pin, duty), and pauseMicros(us).
// Keep ENA/ENB jumpers removed: only the PWM enable pins power the bridges.
template <class IO> class L298NBridge {
 public:
  L298NBridge(int input1, int input2, int enablePin)
      : a(input1), b(input2), en(enablePin) {}

  void apply(float value) {
    if (!isfinite(value) || fabsf(value) > 1) value = 0;
    uint32_t duty = (uint32_t)lroundf(fabsf(value) * 255);
    int direction = duty == 0 ? 0 : value > 0 ? 1 : -1;
    if (direction != previousDirection || direction == 0) {
      IO::enable(en, 0);
      if (previousDirection != 0 && direction != 0) IO::pauseMicros(10);
      IO::direction(a, direction > 0);
      IO::direction(b, direction < 0);
    }
    IO::enable(en, duty);
    previousDirection = direction;
  }

 private:
  int a, b, en, previousDirection = 0;
};
