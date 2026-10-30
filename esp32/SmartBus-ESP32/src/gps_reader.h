#pragma once

/**
 * NEO-6M GPS input.
 *
 * The GPS module never blocks the boarding flow: bytes are drained in poll()
 * and the freshest fix is read from the parser. A missing, stale or invalid
 * fix is reported as such - never as a coordinate.
 */

#include <Arduino.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>

namespace gps_reader {

struct Snapshot {
    bool moduleConnected;   // NMEA traffic seen recently
    bool fixValid;          // the parser holds a valid location
    bool isFresh;           // fixValid AND newer than GPS_MAX_FIX_AGE_MS
    double latitude;
    double longitude;
    uint32_t ageMs;         // time since the fix was taken
    uint32_t satellites;
    double hdop;
    unsigned long charsProcessed;
};

/** Start UART1 on the GPS pin. */
void begin();

/** Drain pending NMEA bytes; call every loop iteration. */
void poll();

/** Current state of the receiver. */
Snapshot snapshot();

/**
 * Fill a JSON object with the position report for the backend:
 *   {latitude, longitude, age_seconds, satellites, hdop, fix_status}
 * Returns false when there is nothing trustworthy to report.
 */
bool fillReport(JsonObject gpsObject);

/** True when a fix is fresh enough to be reported with an SOS. */
bool hasFreshFix();

} // namespace gps_reader
