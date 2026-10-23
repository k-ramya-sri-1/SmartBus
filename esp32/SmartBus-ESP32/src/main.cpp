
#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "wifi_config.h"

// RC522 pin assignments
#define RFID_SDA  1
#define RFID_SCK  2
#define RFID_MOSI 14
#define RFID_MISO 21
#define RFID_RST  42

// SmartBus backend
const char* BACKEND_URL = "http://192.168.0.107:5000";

// DEMONSTRATION SETTINGS ONLY
// These values are not real face verification.
const bool DEMO_SIMULATED_FACE_VERIFICATION = true;
const int DEMO_BUS_ID = 1;
const int DEMO_ROUTE_ID = 1;

MFRC522 rfid(RFID_SDA, RFID_RST);

unsigned long successfulReads = 0;
unsigned long failedReads = 0;
unsigned long lastSummary = 0;
unsigned long lastWiFiAttempt = 0;

// Duplicate-scan protection
bool waitingForCardRemoval = false;
unsigned long cardRemovalStart = 0;
const unsigned long CARD_REMOVAL_CONFIRM_MS = 1000;

void connectWiFi() {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    Serial.println("Connecting to Wi-Fi...");
    unsigned long start = millis();

    while (WiFi.status() != WL_CONNECTED &&
           millis() - start < 20000) {
        delay(500);
        Serial.print(".");
    }

    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("Wi-Fi connected!");
        Serial.print("ESP32 IP: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("Wi-Fi connection failed.");
    }

    lastWiFiAttempt = millis();
}

bool backendGet(const String& url, String& response) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("Wi-Fi disconnected.");
        return false;
    }

    WiFiClient client;
    HTTPClient http;
    http.setTimeout(5000);

    if (!http.begin(client, url)) {
        Serial.println("Could not start GET request.");
        return false;
    }

    int status = http.GET();
    bool ok = status >= 200 && status < 300;

    Serial.printf("GET HTTP status: %d\n", status);

    if (status > 0) {
        response = http.getString();
    } else {
        Serial.println(http.errorToString(status));
    }

    http.end();
    return ok;
}

bool authorizeBoarding(int studentDbId, int rfidCardId) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("Cannot authorize: Wi-Fi disconnected.");
        return false;
    }

    WiFiClient client;
    HTTPClient http;

    String url = String(BACKEND_URL) + "/api/authorization/check";
    http.setTimeout(5000);

    if (!http.begin(client, url)) {
        Serial.println("Could not start authorization request.");
        return false;
    }

    http.addHeader("Content-Type", "application/json");

    JsonDocument request;
    request["student_id"] = studentDbId;
    request["bus_id"] = DEMO_BUS_ID;
    request["route_id"] = DEMO_ROUTE_ID;
    request["rfid_card_id"] = rfidCardId;

    // DEMO ONLY: this simulates a successful face check.
    request["face_verified"] =
        DEMO_SIMULATED_FACE_VERIFICATION;

    String body;
    serializeJson(request, body);

    Serial.println();
    Serial.println("=== DEMO AUTHORIZATION ===");
    Serial.println("Face verification: SIMULATED");
    Serial.printf("Bus ID: %d\n", DEMO_BUS_ID);
    Serial.printf("Route ID: %d\n", DEMO_ROUTE_ID);

    int status = http.POST(body);

    if (status > 0) {
        String response = http.getString();
        Serial.printf("Authorization HTTP status: %d\n", status);
        Serial.println("Authorization response:");
        Serial.println(response);

        JsonDocument result;
        DeserializationError error = deserializeJson(result, response);

        if (!error && result["authorized"] == true) {
            Serial.println("DEMO RESULT: ACCESS GRANTED");
            http.end();
            return true;
        }

        Serial.println("DEMO RESULT: ACCESS DENIED");
    } else {
        Serial.print("Authorization request failed: ");
        Serial.println(http.errorToString(status));
    }

    http.end();
    return false;
}

void processCard() {
    if (!rfid.PICC_ReadCardSerial()) {
        failedReads++;
        Serial.println("Card detected, but UID read failed.");
        return;
    }

    successfulReads++;

    String uid = "";

    Serial.print("RFID UID: ");

    for (byte i = 0; i < rfid.uid.size; i++) {
        if (rfid.uid.uidByte[i] < 0x10) {
            uid += "0";
        }

        uid += String(rfid.uid.uidByte[i], HEX);
        Serial.printf("%02X ", rfid.uid.uidByte[i]);
    }

    uid.toUpperCase();
    Serial.println();

    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();

    // Step 1: Look up the card in the backend.
    String response;
    String lookupUrl =
        String(BACKEND_URL) + "/api/rfid/" + uid;

    if (!backendGet(lookupUrl, response)) {
        Serial.println("RFID lookup failed.");
        return;
    }

    JsonDocument studentData;
    DeserializationError error =
        deserializeJson(studentData, response);

    if (error) {
        Serial.println("Could not parse student response.");
        return;
    }

    if (!studentData["success"].as<bool>()) {
        Serial.println("Card is not registered.");
        return;
    }

    JsonObject student = studentData["student"];

    int studentDbId = student["student_db_id"] | 0;
    int cardId = student["rfid_card_id"] | 0;
    const char* studentStatus =
        student["student_status"] | "";
    const char* cardStatus =
        student["rfid_status"] | "";

    if (studentDbId <= 0 || cardId <= 0 ||
        strcmp(studentStatus, "ACTIVE") != 0 ||
        strcmp(cardStatus, "ACTIVE") != 0) {
        Serial.println("Student or RFID card is inactive/invalid.");
        return;
    }

    Serial.printf("Student: %s\n",
        student["name"] | "Unknown");
    Serial.printf("Student database ID: %d\n", studentDbId);
    Serial.printf("RFID card database ID: %d\n", cardId);

    // Step 2: Test the backend authorization rules.
    // Face verification is simulated, not performed by a camera.
    authorizeBoarding(studentDbId, cardId);

    Serial.println("===========================\n");
}

void setup() {
    Serial.begin(115200);
    delay(1500);

    Serial.println();
    Serial.println("=== SmartBus Boarding Demo ===");
    Serial.println("WARNING: Face verification is simulated.");

    connectWiFi();

    SPI.begin(RFID_SCK, RFID_MISO, RFID_MOSI, RFID_SDA);
    rfid.PCD_Init();
    rfid.PCD_SetAntennaGain(MFRC522::RxGain_max);
    delay(50);

    Serial.printf("RFID firmware: 0x%02X\n",
        rfid.PCD_ReadRegister(rfid.VersionReg));
    Serial.println("Ready to scan a registered card.");
}

void loop() {
    if (WiFi.status() != WL_CONNECTED &&
        millis() - lastWiFiAttempt >= 10000) {
        connectWiFi();
    }

    // After processing a card, wait for its removal before
    // allowing another authorization request.
    if (waitingForCardRemoval) {
        byte atqa[2];
        byte atqaSize = sizeof(atqa);

        MFRC522::StatusCode status =
            rfid.PICC_WakeupA(atqa, &atqaSize);

        if (status == MFRC522::STATUS_OK) {
            // A card is still present. Reset the removal timer.
            cardRemovalStart = 0;

            // Put the card back into the halted state.
            rfid.PICC_HaltA();
            rfid.PCD_StopCrypto1();
        } else {
            // No card was detected. Require a continuous
            // one-second absence before accepting another scan.
            if (cardRemovalStart == 0) {
                cardRemovalStart = millis();
            } else if (
                millis() - cardRemovalStart >=
                CARD_REMOVAL_CONFIRM_MS
            ) {
                waitingForCardRemoval = false;
                cardRemovalStart = 0;
                Serial.println(
                    "Card removal confirmed. Ready for next scan."
                );
            }
        }

        delay(100);
        return;
    }

    if (rfid.PICC_IsNewCardPresent()) {
        // Lock scanning before sending network requests.
        waitingForCardRemoval = true;
        cardRemovalStart = 0;

        processCard();

        delay(100);
    }

    if (millis() - lastSummary >= 15000) {
        lastSummary = millis();

        Serial.println("=== Reliability Summary ===");
        Serial.printf("Successful reads: %lu\n", successfulReads);
        Serial.printf("Failed reads: %lu\n", failedReads);
        Serial.printf("Wi-Fi: %s\n",
            WiFi.status() == WL_CONNECTED
                ? "CONNECTED" : "DISCONNECTED");
        Serial.println("===========================\n");
    }

    delay(50);
}