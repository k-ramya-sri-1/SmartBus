#pragma once

/**
 * SOS button.
 *
 * A short press is debounced and latched even while a blocking HTTP request is
 * in flight, because the latch is set from the GPIO interrupt. The main loop
 * then consumes it as soon as it is free, so an emergency is never lost.
 */

#include <Arduino.h>

namespace sos_button {

void begin();

/** Debounced latch: true once per press, then cleared. */
bool consumePress();

/** Milliseconds since the last accepted press (0 if never pressed). */
unsigned long lastPressAgo();

} // namespace sos_button
