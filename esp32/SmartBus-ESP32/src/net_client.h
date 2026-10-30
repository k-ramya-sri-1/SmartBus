#pragma once

/**
 * Wi-Fi and HTTP client for the bus unit.
 *
 * The unit never decides anything on its own: every question ("who is this
 * "capture proof", "may this student board?") is answered by
 * the backend. This module only transports the questions and the answers.
 */

#include <Arduino.h>
#include <ArduinoJson.h>

namespace net_client {

struct BackendReply {
    bool reachable;      // did the HTTP exchange complete at all?
    int  statusCode;     // HTTP status code, 0 when unreachable
    bool success;        // reply parsed and success == true
    JsonDocument body;   // parsed reply (empty when unreachable/invalid)
    String error;        // human-readable failure description
};

void begin();

/** Reconnect in the background; true while associated. */
bool isUp();
void poll();

/** POST a JSON document. */
BackendReply postJson(const String& path, const String& jsonBody, uint32_t timeoutMs);

/** POST a raw JPEG frame (the camera-only proof capture). */
BackendReply postImage(const String& path, const uint8_t* data, size_t length,
                       uint32_t timeoutMs);

/** GET a JSON document. */
BackendReply getJson(const String& path, uint32_t timeoutMs);

} // namespace net_client
