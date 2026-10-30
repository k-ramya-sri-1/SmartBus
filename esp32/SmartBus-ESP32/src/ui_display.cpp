#include "ui_display.h"

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Wire.h>

#include "../include/board_pins.h"
#include "../include/device_config.h"

namespace {

constexpr int SCREEN_WIDTH = 128;
constexpr int SCREEN_HEIGHT = 64;
constexpr uint8_t OLED_ADDRESSES[] = {0x3C, 0x3D};
constexpr size_t OLED_ADDRESS_COUNT =
    sizeof(OLED_ADDRESSES) / sizeof(OLED_ADDRESSES[0]);

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

bool displayReady = false;
uint8_t oledAddress = 0;

ui_display::State current = ui_display::State::Boot;
unsigned long stateSince = 0;
String statusLine;

bool wifiUp = false;
bool gpsFresh = false;
bool buzzerActive = false;
unsigned long buzzerUntil = 0;

void setLeds(bool white, bool red) {
    digitalWrite(PIN_LED_WHITE, white ? HIGH : LOW);
    digitalWrite(PIN_LED_RED, red ? HIGH : LOW);
}

void buzzerWrite(bool on) {
#if BUZZER_ENABLED
    // The buzzer module is active-low: LOW energizes it, HIGH is safe/off.
    digitalWrite(PIN_BUZZER, on ? LOW : HIGH);
#else
    (void)on;
#endif
}

void stopBuzzer() {
    buzzerActive = false;
    buzzerUntil = 0;
    buzzerWrite(false);
}

void startBuzzer(unsigned long durationMs) {
#if BUZZER_ENABLED
    buzzerActive = true;
    buzzerUntil = millis() + durationMs;
    buzzerWrite(true);
#else
    (void)durationMs;
#endif
}

String displayText(const String& value, size_t maxCharacters = 21) {
    if (value.length() <= maxCharacters) {
        return value;
    }

    return value.substring(0, maxCharacters - 3) + "...";
}

void render() {
    if (!displayReady) {
        return;
    }

    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);

    // Status bar: connectivity and emergency flag.
    display.setCursor(0, 0);
    display.printf("%s %s%s",
                   wifiUp ? "NET" : "---",
                   gpsFresh ? " GPS" : " gps",
                   current == ui_display::State::Emergency ? "  SOS" : "");
    display.drawFastHLine(0, 10, SCREEN_WIDTH, SSD1306_WHITE);

    display.setCursor(0, 16);

    switch (current) {
        case ui_display::State::Boot:
            display.println("SMARTBUS");
            display.println("INITIALIZING");
            display.println(displayText(statusLine).c_str());
            break;

        case ui_display::State::Ready:
            display.println("SMARTBUS");
            display.println("SYSTEM READY");
            display.println("READY FOR FACE SCAN");
            break;

        case ui_display::State::Scanning:
            display.println("SMARTBUS");
            display.println("CAPTURING FACE");
            display.println(displayText(statusLine).c_str());
            break;

        case ui_display::State::Verifying:
            display.println("SMARTBUS");
            display.println("VERIFYING FACE");
            display.println(displayText(statusLine).c_str());
            break;

        case ui_display::State::Granted:
            display.println("ACCESS GRANTED");
            display.println(displayText(statusLine).c_str());
            break;

        case ui_display::State::Denied:
            display.println("ACCESS DENIED");
            display.println(displayText(statusLine).c_str());
            break;

        case ui_display::State::Emergency:
            display.println("!!! SOS MODE !!!");
            display.println(displayText(statusLine).c_str());
            break;

        case ui_display::State::Fault:
            display.println("SYSTEM FAULT");
            display.println(displayText(statusLine).c_str());
            break;
    }

    display.display();
}

void enterState(ui_display::State next, const String& line) {
    current = next;
    stateSince = millis();
    statusLine = line;

    switch (next) {
        case ui_display::State::Granted:
            setLeds(true, false);
            stopBuzzer();
            break;
        case ui_display::State::Emergency:
        case ui_display::State::Fault:
            setLeds(false, true);
            break;
        case ui_display::State::Denied:
            setLeds(false, true);
            stopBuzzer();
            break;
        default:
            setLeds(false, false);
            stopBuzzer();
            break;
    }

    render();
}

} // namespace

namespace ui_display {

bool begin() {
    // Preload safe latch levels before enabling the output drivers.
    digitalWrite(PIN_LED_WHITE, LOW);
    digitalWrite(PIN_LED_RED, LOW);
    digitalWrite(PIN_BUZZER, HIGH);
    pinMode(PIN_LED_WHITE, OUTPUT);
    pinMode(PIN_LED_RED, OUTPUT);
    pinMode(PIN_BUZZER, OUTPUT);

    setLeds(false, false);
    stopBuzzer();

    Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL);
    Wire.setClock(400000);

    Serial.printf("OLED: SDA GPIO%d, SCL GPIO%d, scanning 0x3C/0x3D\n",
                  PIN_OLED_SDA, PIN_OLED_SCL);

    for (size_t index = 0; index < OLED_ADDRESS_COUNT; index++) {
        const uint8_t address = OLED_ADDRESSES[index];
        Wire.beginTransmission(address);
        const uint8_t error = Wire.endTransmission();
        Serial.printf("OLED: address 0x%02X %s\n", address,
                      error == 0 ? "responded" : "not detected");

        if (error == 0) {
            oledAddress = address;
            displayReady = display.begin(SSD1306_SWITCHCAPVCC, address);
            if (displayReady) {
                break;
            }

            Serial.printf("OLED: initialization failed at 0x%02X\n", address);
        }
    }

    if (!displayReady) {
        Serial.println("OLED: no usable SSD1306 found; continuing without display");
        return false;
    }

    Serial.printf("OLED: SSD1306 initialized at 0x%02X\n", oledAddress);
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("SMARTBUS");
    display.println("SYSTEM READY");
    display.display();

    return true;
}

void poll() {
    const unsigned long now = millis();

    if (current == State::Emergency) {
        setLeds(false, true);
    }

    if (buzzerActive && static_cast<long>(now - buzzerUntil) >= 0) {
        stopBuzzer();
    }

    if ((current == State::Granted || current == State::Denied)
        && now - stateSince >= RESULT_DISPLAY_MS) {
        showReady();
    }
}

void showBoot(const String& line) {
    enterState(State::Boot, line);
}

void showReady() {
    enterState(State::Ready, "");
}

void showScanning(const String& uid) {
    enterState(State::Scanning, uid);
}

void showVerifying(const String& name) {
    enterState(State::Verifying, name);
}

void showGranted(const String& name) {
    enterState(State::Granted, name);
}

void showDenied(const String& reason) {
    enterState(State::Denied, reason);
}

void showEmergency(const String& status) {
    enterState(State::Emergency, status);
}

void showFault(const String& component, const String& detail) {
    enterState(State::Fault, component + " " + detail);
}

void beepDenied() {
    startBuzzer(DENIAL_BUZZER_MS);
}

void beepEmergency() {
    startBuzzer(EMERGENCY_BUZZER_MS);
}

void setConnectivity(bool wifi, bool gps) {
    const bool changed = (wifi != wifiUp) || (gps != gpsFresh);

    wifiUp = wifi;
    gpsFresh = gps;

    if (changed && current == State::Ready) {
        render();
    }
}

} // namespace ui_display
