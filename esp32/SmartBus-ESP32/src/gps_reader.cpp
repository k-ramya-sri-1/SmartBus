#include "gps_reader.h"

#include <HardwareSerial.h>

#include "../include/board_pins.h"
#include "../include/device_config.h"

namespace {

HardwareSerial gpsSerial(1);
TinyGPSPlus gps;

unsigned long lastByteMs = 0;
bool connected = false;

// No NMEA traffic for this long means the module is unplugged or hung.
constexpr unsigned long MODULE_SILENCE_MS = 10'000;

} // namespace

namespace gps_reader {

void begin() {
    // 9600 8N1 is the NEO-6M factory default. Only the receive line is wired.
    gpsSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
    lastByteMs = millis();
    Serial.printf("GPS: UART1 listening on GPIO%d at 9600 baud\n", PIN_GPS_RX);
}


void poll() {
    while (gpsSerial.available() > 0) {
        const int byte = gpsSerial.read();
        if (byte < 0) break;

        lastByteMs = millis();
        gps.encode(static_cast<char>(byte));
    }

    connected = (millis() - lastByteMs) < MODULE_SILENCE_MS;

    // Print GPS diagnostics every 2 seconds without flooding Serial Monitor.
    static unsigned long lastDiagnosticMs = 0;
    const unsigned long now = millis();

    if (now - lastDiagnosticMs >= 2000) {
        lastDiagnosticMs = now;

        Serial.printf(
            "GPS DEBUG: module=%s, fix=%s, satellites=%u, "
            "chars=%lu, passed=%lu, failed=%lu, age_ms=%lu\n",
            connected ? "ACTIVE" : "SILENT",
            gps.location.isValid() ? "VALID" : "INVALID",
            gps.satellites.isValid() ? gps.satellites.value() : 0,
            static_cast<unsigned long>(gps.charsProcessed()),
            static_cast<unsigned long>(gps.passedChecksum()),
            static_cast<unsigned long>(gps.failedChecksum()),
            gps.location.isValid()
                ? static_cast<unsigned long>(gps.location.age())
                : 0UL
        );
    }
}


Snapshot snapshot() {
    Snapshot snap;
    snap.moduleConnected = connected;
    snap.fixValid = gps.location.isValid();
    snap.satellites = gps.satellites.isValid() ? gps.satellites.value() : 0;
    snap.hdop = gps.hdop.isValid() ? gps.hdop.hdop() : 0.0;
    snap.charsProcessed = gps.charsProcessed();

    // TinyGPSPlus reports how long ago the last valid fix was updated.
    snap.ageMs = snap.fixValid ? gps.location.age() : 0;
    snap.isFresh = snap.fixValid && snap.ageMs < GPS_MAX_FIX_AGE_MS;

    snap.latitude = snap.isFresh ? gps.location.lat() : 0.0;
    snap.longitude = snap.isFresh ? gps.location.lng() : 0.0;

    return snap;
}

bool fillReport(JsonObject gpsObject) {
    const Snapshot snap = snapshot();

    if (!snap.isFresh) {
        return false;
    }

    gpsObject["latitude"] = snap.latitude;
    gpsObject["longitude"] = snap.longitude;
    gpsObject["age_seconds"] = snap.ageMs / 1000;
    gpsObject["satellites"] = snap.satellites;
    gpsObject["hdop"] = snap.hdop;
    gpsObject["fix_status"] = "GPS_FIX";    return true;
}

bool hasFreshFix() {
    return snapshot().isFresh;
}

} // namespace gps_reader
