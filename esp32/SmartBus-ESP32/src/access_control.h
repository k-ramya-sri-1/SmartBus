#pragma once

/**
 * The boarding state machine.
 *
 * Exactly one order is implemented, matching the project flow:
 *
 *   CAPTURE command -> capture -> camera proof -> authorization -> indication
 *
 * Nothing is decided locally. The unit asks the backend at each step and
 * treats every failure (no network, camera error, timeout, denial) as a closed
 * gate. Serial input is handled by the regular polling loop and only one
 * boarding attempt can run at a time.
 */

#include <Arduino.h>

namespace access_control {

void begin();

/** Run the scheduler: serial commands, GPS reporting, SOS handling, UI ticks. */
void poll();

} // namespace access_control
