#include "net_client.h"

#include <HTTPClient.h>
#include <WiFi.h>

#include "../include/device_config.h"
#include "wifi_config.h"

namespace {

constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 10'000;

unsigned long lastWifiAttempt = 0;
bool wifiReportedUp = false;

void attachDeviceHeaders(HTTPClient& http) {
    http.addHeader("X-Device-Id", DEVICE_UID);
    http.addHeader("X-Device-Key", DEVICE_KEY);
}

bool parseReply(HTTPClient& http, int statusCode, net_client::BackendReply& reply) {
    reply.reachable = true;
    reply.statusCode = statusCode;

    if (statusCode <= 0) {
        reply.error = http.errorToString(statusCode);
        return false;
    }

    const String payload = http.getString();

    if (payload.isEmpty()) {
        reply.error = "empty response";
        return false;
    }

    const DeserializationError error = deserializeJson(reply.body, payload);

    if (error) {
        reply.error = "invalid JSON: ";
        reply.error += error.c_str();
        return false;
    }

    reply.success = reply.body["success"].as<bool>();
    return true;
}

} // namespace

namespace net_client {

void begin() {
    WiFi.mode(WIFI_STA);
    // Credentials come from include/wifi_config.h, which is git-ignored.
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    lastWifiAttempt = millis();
    wifiReportedUp = false;
    Serial.print("Wi-Fi: connecting to \"");
    Serial.print(WIFI_SSID);
    Serial.println("\"...");
}

bool isUp() {
    return WiFi.status() == WL_CONNECTED;
}

void poll() {
    const bool up = isUp();

    if (up != wifiReportedUp) {
        wifiReportedUp = up;
        Serial.println(up
            ? "Wi-Fi connected, IP: " + WiFi.localIP().toString()
            : "Wi-Fi lost connection");
    }

    if (!up && millis() - lastWifiAttempt >= WIFI_RETRY_INTERVAL_MS) {
        lastWifiAttempt = millis();
        Serial.println("Wi-Fi: connecting...");
        WiFi.reconnect();
    }
}

BackendReply postJson(const String& path, const String& jsonBody, uint32_t timeoutMs) {
    BackendReply reply;

    if (!isUp()) {
        reply.error = "Wi-Fi not connected";
        return reply;
    }

    const String url = String("http://") + BACKEND_HOST + ":" + BACKEND_PORT + path;

    WiFiClient client;
    HTTPClient http;

    if (!http.begin(client, url)) {
        reply.error = "could not start request";
        return reply;
    }

    http.setTimeout(timeoutMs);
    http.addHeader("Content-Type", "application/json");
    attachDeviceHeaders(http);

    const int statusCode = http.POST(jsonBody);
    parseReply(http, statusCode, reply);
    http.end();

    return reply;
}

BackendReply postImage(const String& path, const uint8_t* data, size_t length,
                       uint32_t timeoutMs) {
    BackendReply reply;

    if (!isUp()) {
        reply.error = "Wi-Fi not connected";
        return reply;
    }

    const String url = String("http://") + BACKEND_HOST + ":" + BACKEND_PORT + path;

    WiFiClient client;
    HTTPClient http;

    if (!http.begin(client, url)) {
        reply.error = "could not start request";
        return reply;
    }

    http.setTimeout(timeoutMs);
    http.addHeader("Content-Type", "image/jpeg");
    attachDeviceHeaders(http);

    const int statusCode = http.POST(const_cast<uint8_t*>(data), length);
    parseReply(http, statusCode, reply);
    http.end();

    return reply;
}

BackendReply getJson(const String& path, uint32_t timeoutMs) {
    BackendReply reply;

    if (!isUp()) {
        reply.error = "Wi-Fi not connected";
        return reply;
    }

    const String url = String("http://") + BACKEND_HOST + ":" + BACKEND_PORT + path;

    WiFiClient client;
    HTTPClient http;

    if (!http.begin(client, url)) {
        reply.error = "could not start request";
        return reply;
    }

    http.setTimeout(timeoutMs);
    attachDeviceHeaders(http);

    const int statusCode = http.GET();
    parseReply(http, statusCode, reply);
    http.end();

    return reply;
}

} // namespace net_client
