#include "sos_button.h"

#include "../include/board_pins.h"

namespace {

// Set from the ISR; consumed from the main loop.
volatile bool pressedLatch = false;
volatile unsigned long lastIsrMs = 0;

unsigned long lastAcceptedMs = 0;
bool everPressed = false;

// Ignore contact bounce and repeated presses within this window.
constexpr unsigned long DEBOUNCE_MS = 250;

void IRAM_ATTR onButtonFalling() {
    const unsigned long now = millis();

    if (now - lastIsrMs < DEBOUNCE_MS) {
        return;
    }

    lastIsrMs = now;
    pressedLatch = true;
}

} // namespace

namespace sos_button {

void begin() {
    pinMode(PIN_SOS_BUTTON, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(PIN_SOS_BUTTON), onButtonFalling, FALLING);
    Serial.printf("SOS button on GPIO%d (active LOW)\n", PIN_SOS_BUTTON);
}

bool consumePress() {
    if (!pressedLatch) {
        return false;
    }

    pressedLatch = false;
    lastAcceptedMs = millis();
    everPressed = true;
    return true;
}

unsigned long lastPressAgo() {
    if (!everPressed) {
        return 0;
    }

    return millis() - lastAcceptedMs;
}

} // namespace sos_button
