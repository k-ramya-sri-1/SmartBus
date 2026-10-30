#pragma once

/**
 * SmartBus pin map - ESP32-S3-WROOM-1 N16R8 (16 MB flash, 8 MB octal PSRAM)
 *
 * This file is the single source of truth for the wiring of the bus unit.
 * Every assignment below was checked against:
 *
 *   * the OV2640 wiring that the camera_test project already captured with
 *   * the SSD1306 wiring that the oled_test project already drove
 *   * the ESP32-S3-WROOM-1 module constraints
 *
 * Module constraints that force two changes compared to the old
 * hardware_test / gps_test wiring:
 *
 *   1. GPIO 33-37 are wired to the octal PSRAM inside an N16R8 module and
 *      must not be used. The old hardware_test used GPIO 36 (white LED) and
 *      GPIO 35 (SOS) - those pins belong to the PSRAM on this module, so the
 *      LED and the button are moved to GPIO 47 / 39.
 *   2. GPS was previously on GPIO 17/18, which are the camera data lines
 *      Y8/Y7. That overlap is why GPS serial data and the camera could never
 *      work together. GPS now lives on GPIO 38.
 *
 * Pins intentionally left alone:
 *   GPIO 43/44  UART0, USB-UART bridge - serial console and flashing
 *   GPIO 0, 45, 46 - strapping pins, not used
 *   GPIO 26-32  module flash, not available
 *   GPIO 19/20  native USB D-/D+, kept free
 *
 * The compile-time check at the bottom of this file fails the build if any
 * two peripherals are ever assigned the same pin again.
 */

// --- OV2640 camera (verified by camera_test / capture_image.py) -----------
#define PIN_CAM_XCLK     15
#define PIN_CAM_SIOD      4   // SCCB SDA
#define PIN_CAM_SIOC      5   // SCCB SCL
#define PIN_CAM_D0       11   // Y2
#define PIN_CAM_D1        9   // Y3
#define PIN_CAM_D2        8   // Y4
#define PIN_CAM_D3       10   // Y5
#define PIN_CAM_D4       12   // Y6
#define PIN_CAM_D5       18   // Y7
#define PIN_CAM_D6       17   // Y8
#define PIN_CAM_D7       16   // Y9
#define PIN_CAM_VSYNC     6
#define PIN_CAM_HREF      7
#define PIN_CAM_PCLK     13

// --- SSD1306 OLED (verified by oled_test) ----------------------------------
#define PIN_OLED_SDA     41
#define PIN_OLED_SCL     40

// --- NEO-6M GPS ------------------------------------------------------------
// Only the NEO-6M TX line is required; the module's RX (configuration input)
// is not driven by this firmware.
#define PIN_GPS_RX       38   // ESP32 receives NEO-6M TX here (UART1)
#define PIN_GPS_TX       -1   // not connected

// --- Indicators and inputs (moved off the PSRAM pins) ----------------------
#define PIN_LED_WHITE    47   // access granted
#define PIN_LED_RED      48   // access denied / warning
#define PIN_BUZZER        3   // strapping pin (JTAG source); safe as an output
                              // after boot - see docs for the driver circuit
#define PIN_SOS_BUTTON   39   // to GND, internal pull-up, active LOW

namespace smartbus_pins {

struct PinUse {
    int pin;
    const char* owner;
};

constexpr PinUse ALL_PINS[] = {
    {PIN_CAM_XCLK,   "camera XCLK"},
    {PIN_CAM_SIOD,   "camera SIOD"},
    {PIN_CAM_SIOC,   "camera SIOC"},
    {PIN_CAM_D0,     "camera D0"},
    {PIN_CAM_D1,     "camera D1"},
    {PIN_CAM_D2,     "camera D2"},
    {PIN_CAM_D3,     "camera D3"},
    {PIN_CAM_D4,     "camera D4"},
    {PIN_CAM_D5,     "camera D5"},
    {PIN_CAM_D6,     "camera D6"},
    {PIN_CAM_D7,     "camera D7"},
    {PIN_CAM_VSYNC,  "camera VSYNC"},
    {PIN_CAM_HREF,   "camera HREF"},
    {PIN_CAM_PCLK,   "camera PCLK"},
    {PIN_OLED_SDA,   "OLED SDA"},
    {PIN_OLED_SCL,   "OLED SCL"},
    {PIN_GPS_RX,     "GPS RX"},
    {PIN_GPS_TX,     "GPS TX"},
    {PIN_LED_WHITE,  "white LED"},
    {PIN_LED_RED,    "red LED"},
    {PIN_BUZZER,     "buzzer"},
    {PIN_SOS_BUTTON, "SOS button"}
};

constexpr size_t PIN_COUNT = sizeof(ALL_PINS) / sizeof(ALL_PINS[0]);

constexpr bool hasPinConflict() {
    for (size_t i = 0; i < PIN_COUNT; i++) {
        if (ALL_PINS[i].pin < 0) {
            continue;
        }
        for (size_t j = i + 1; j < PIN_COUNT; j++) {
            if (ALL_PINS[i].pin == ALL_PINS[j].pin) {
                return true;
            }
        }
    }
    return false;
}

// GPIO 33-37 are owned by the octal PSRAM of an N16R8 module.
constexpr bool touchesPsramPins() {
    for (size_t i = 0; i < PIN_COUNT; i++) {
        const int pin = ALL_PINS[i].pin;
        if (pin >= 33 && pin <= 37) {
            return true;
        }
    }
    return false;
}

} // namespace smartbus_pins

static_assert(!smartbus_pins::hasPinConflict(),
    "SmartBus pin conflict: two peripherals are assigned the same GPIO. "
    "Fix include/board_pins.h before flashing.");

static_assert(!smartbus_pins::touchesPsramPins(),
    "SmartBus pin conflict: GPIO 33-37 are used by the octal PSRAM of the "
    "ESP32-S3-WROOM-1 N16R8 and cannot drive external hardware.");
