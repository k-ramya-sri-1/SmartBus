#include "access_control.h"

#include <ArduinoJson.h>

#include "../include/device_config.h"
#include "camera_capture.h"
#include "gps_reader.h"
#include "net_client.h"
#include "sos_button.h"
#include "ui_display.h"

namespace {

unsigned long lastGpsReport = 0;
unsigned long lastStatusTick = 0;
bool boardingInProgress = false;
char serialLine[32] = {};
size_t serialLineLength = 0;

String newEventId() {
    // Unique per scan, so a retried request cannot create a second record.
    char buffer[48];
    snprintf(buffer, sizeof(buffer), "evt-%08lX-%08lX",
             static_cast<unsigned long>(millis()),
             static_cast<unsigned long>(esp_random()));
    return String(buffer);
}

void fillGps(JsonDocument& request) {
    JsonObject gps = request["gps"].to<JsonObject>();
    gps_reader::fillReport(gps);
}

/** Send the backend-issued camera proof for the authoritative access decision. */
void reportAttempt(const String& eventId, int verificationId,
                   const String& faceProof, String& displayReason, bool& granted) {
    JsonDocument request;
    request["route_id"] = BUS_ROUTE_ID;
    request["client_event_id"] = eventId;

    if (faceProof.length() > 0) {
        request["face_proof"] = faceProof;
    }

    if (verificationId > 0) {
        request["face_verification_id"] = verificationId;
    }

    fillGps(request);

    String body;
    serializeJson(request, body);

    const net_client::BackendReply reply = net_client::postJson(
        "/api/authorization/camera-check", body, HTTP_TIMEOUT_MS);

    if (!reply.reachable) {
        granted = false;
        displayReason = "NETWORK ERROR";
        return;
    }

    granted = reply.success && reply.body["authorized"].is<bool>()
        && reply.body["authorized"].as<bool>();
    displayReason = reply.body["display_reason"] | (granted ? "GRANTED" : "DENIED");
}

/** Map a face-service decision onto the 16-character OLED vocabulary. */
String faceDecisionReason(const char* decision) {
    if (strcmp(decision, "NO_FACE") == 0) return "NO FACE";
    if (strcmp(decision, "MULTIPLE_FACES") == 0) return "ONE FACE ONLY";
    if (strcmp(decision, "DIFFERENT_STUDENT") == 0) return "WRONG PERSON";
    if (strcmp(decision, "LOW_SCORE") == 0) return "FACE MISMATCH";
    if (strcmp(decision, "NOT_ENROLLED") == 0) return "NOT ENROLLED";
    if (strcmp(decision, "ENGINE_UNAVAILABLE") == 0) return "FACE SVC DOWN";
    if (strcmp(decision, "IMAGE_INVALID") == 0) return "BAD IMAGE";
    return "FACE ERROR";
}

void handleCapture() {
    boardingInProgress = true;
    ui_display::showScanning("CAMERA");
    Serial.println("\n--- Camera capture ---");

    const String eventId = newEventId();
    const gps_reader::Snapshot gps = gps_reader::snapshot();
    String reason;
    String displayReason;
    String studentName = "STUDENT";
    bool granted = false;
    int verificationId = 0;
    String faceProof;

    // ---- 1. Capture and issue a camera-only proof ----------------------
    const camera_capture::Capture frame = camera_capture::grab();

    if (frame.error != camera_capture::CaptureError::None) {
        reason =
            frame.error == camera_capture::CaptureError::NotInitialised ? "CAMERA FAULT" :
            frame.error == camera_capture::CaptureError::EmptyFrame ? "CAMERA EMPTY" :
            "CAMERA TIMEOUT";
    } else {
        ui_display::showVerifying("FACE SERVICE");
        const net_client::BackendReply faceReply = net_client::postImage(
            "/api/face/camera-proof", frame.data, frame.length, FACE_TIMEOUT_MS);
            Serial.printf(
                "FACE HTTP status: %d, reachable: %s, success: %s\n",
                faceReply.statusCode,
                faceReply.reachable ? "yes" : "no",
                faceReply.success ? "yes" : "no"
            );
            String faceResponse;
            serializeJson(faceReply.body, faceResponse);
            Serial.println("FACE response: " + faceResponse);
            if (faceReply.error.length() > 0) {
                Serial.println("FACE request error: " + faceReply.error);
            }

        // Return the driver-owned frame on every successful capture path.
        camera_capture::release(frame);

        if (!faceReply.reachable) {
            reason = "NETWORK ERROR";
        } else if (!faceReply.success) {
            reason = faceDecisionReason(faceReply.body["decision"] | "FACE ERROR");
        } else {
            faceProof = faceReply.body["face_proof"].as<String>();
            verificationId = faceReply.body["verification_id"] | 0;
            studentName = faceReply.body["student"]["name"] | "STUDENT";

            if (faceProof.isEmpty()) {
                reason = "FACE INVALID";
            }
        }
    }

    // ---- 2. Authoritative camera-only decision -------------------------
    displayReason = reason.isEmpty() ? "DENIED" : reason;
    reportAttempt(eventId, verificationId, faceProof, displayReason, granted);

    // ---- 5. Indication ---------------------------------------------------
    if (granted) {
        ui_display::showGranted(studentName);
        Serial.printf("GRANTED: %s (%s)\n", studentName.c_str(),
                      gps.isFresh ? "GPS fix" : "no GPS fix");
    } else {
        ui_display::showDenied(displayReason);
        ui_display::beepDenied();
        Serial.printf("DENIED: %s\n", displayReason.c_str());
    }

    boardingInProgress = false;
}

void pollSerial() {
    while (Serial.available() > 0) {
        const char character = static_cast<char>(Serial.read());

        if (character == '\r') {
            continue;
        }

        if (character == '\n') {
            serialLine[serialLineLength] = '\0';

            if (strcmp(serialLine, "CAPTURE") == 0 && !boardingInProgress) {
                handleCapture();
                // Commands received while the blocking capture/request was in
                // progress belong to that busy period, not a new boarding.
                while (Serial.available() > 0) {
                    Serial.read();
                }
                serialLineLength = 0;
                return;
            }

            serialLineLength = 0;
            continue;
        }

        if (serialLineLength < sizeof(serialLine) - 1) {
            serialLine[serialLineLength++] = character;
        } else {
            serialLineLength = 0;
        }
    }
}

void sendSos() {
    ui_display::showEmergency("Sending...");
    ui_display::beepEmergency();

    const gps_reader::Snapshot snap = gps_reader::snapshot();

    JsonDocument request;
    request["event_type"] = "SOS";

    // Coordinates are only included when the receiver actually has a fix.
    // Without one, the backend records the position as UNAVAILABLE.
    if (snap.isFresh) {
        request["latitude"] = snap.latitude;
        request["longitude"] = snap.longitude;
    }

    String body;
    serializeJson(request, body);

    bool sent = false;
    int eventId = 0;

    for (int attempt = 1; attempt <= 3 && !sent; attempt++) {
        const net_client::BackendReply reply =
            net_client::postJson("/api/emergency", body, HTTP_TIMEOUT_MS);

        if (reply.reachable && reply.success) {
            sent = true;
            eventId = reply.body["emergency"]["id"] | 0;
            break;
        }

        Serial.printf("SOS attempt %d failed: %s\n", attempt, reply.error.c_str());
        delay(1000);
    }

    if (sent) {
        ui_display::showEmergency(eventId > 0 ? "SOS sent #" + String(eventId) : "SOS sent");
        Serial.printf("SOS delivered (event %d)\n", eventId);
    } else {
        ui_display::showEmergency("SOS NOT SENT");
        Serial.println("SOS could not be delivered - check Wi-Fi and backend");
    }

    delay(2500);
    ui_display::showReady();
}

void reportGps() {
    const gps_reader::Snapshot snap = gps_reader::snapshot();

    if (!snap.isFresh || millis() - lastGpsReport < GPS_REPORT_INTERVAL_MS) {
        return;
    }

    lastGpsReport = millis();

    JsonDocument request;
    request["latitude"] = snap.latitude;
    request["longitude"] = snap.longitude;
    request["age_seconds"] = snap.ageMs / 1000;
    request["satellites"] = snap.satellites;
    request["hdop"] = snap.hdop;
    request["fix_status"] = "GPS_FIX";

    String body;
    serializeJson(request, body);

    const net_client::BackendReply reply =
        net_client::postJson("/api/gps/location", body, HTTP_TIMEOUT_MS);

    if (!reply.reachable || !reply.success) {
        Serial.printf("GPS report failed: %s\n", reply.error.c_str());
    }
}

} // namespace

namespace access_control {

void begin() {
    const bool displayOk = ui_display::begin();

    if (!displayOk) {
        Serial.println("WARNING: OLED initialization failed");
    }

    ui_display::showBoot("Starting...");

    net_client::begin();
    gps_reader::begin();
    sos_button::begin();

    const bool cameraOk = camera_capture::begin();

    if (!cameraOk) {
        // Stay up so the fault is visible on the OLED instead of rebooting in
        // a loop, but the unit cannot grant anything in this state.
        ui_display::showFault("Camera", "not ready");
        Serial.println("FATAL: a mandatory peripheral failed to initialise");
    } else {
        ui_display::showReady();
    }

    Serial.printf("Device %s, route %d, backend %s:%d\n",
                  DEVICE_UID, BUS_ROUTE_ID, BACKEND_HOST, BACKEND_PORT);
}

void poll() {
    net_client::poll();
    gps_reader::poll();

    if (millis() - lastStatusTick >= 1000) {
        lastStatusTick = millis();
        ui_display::setConnectivity(net_client::isUp(), gps_reader::snapshot().isFresh);
    }

    if (sos_button::consumePress()) {
        sendSos();
    }

    reportGps();

    pollSerial();

    ui_display::poll();
}

} // namespace access_control
