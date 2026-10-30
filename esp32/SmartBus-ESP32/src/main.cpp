/**
 * SmartBus access-control unit - ESP32-S3-WROOM-1 N16R8 CAM.
 *
 * Wiring, pin rationale and the conflicts that were resolved live in
 * include/board_pins.h. The boarding flow lives in src/access_control.cpp.
 *
 * This firmware does not decide anything by itself. It accepts a CAPTURE
 * command, captures a frame, and asks the backend; the backend issues a
 * camera-only proof, checks the bus/route authorization and returns the
 * decision, which is then shown on the OLED and the LEDs.
 */

#include <Arduino.h>

#include "access_control.h"
#include "board_pins.h"
#include "device_config.h"
#include "ui_display.h"

void setup() {
    Serial.begin(115200);
    delay(1200);

    Serial.println();
    Serial.println("====================================");
    Serial.println(" SmartBus access unit");
    Serial.println(" ESP32-S3-WROOM-1 N16R8 CAM");
    Serial.println("====================================");

    Serial.printf("PSRAM: %s (%u KB free)\n",
                  psramFound() ? "found" : "MISSING",
                  static_cast<unsigned>(ESP.getFreePsram() / 1024));

    if (!psramFound()) {
        // The camera frame buffers live in PSRAM, so this is fatal rather than
        // a warning: without it every capture would fail.
        Serial.println("FATAL: no PSRAM detected. Check board_build.psram_type=opi.");
    }

    if (strlen(DEVICE_KEY) < 32) {
        Serial.println("WARNING: DEVICE_KEY is not configured.");
        Serial.println("         Register the device and copy include/device_secrets.example.h");
        Serial.println("         to include/device_secrets.h, then rebuild.");
    }

    access_control::begin();
}

void loop() {
    access_control::poll();
    delay(5);
}
