#pragma once

/**
 * Device identity and service configuration.
 *
 * The Wi-Fi credentials live in include/wifi_config.h (already present,
 * git-ignored). The per-device identity lives in include/device_secrets.h,
 * which is created from include/device_secrets.example.h:
 *
 *   1. register the device:  POST /api/devices  (administrator)
 *   2. copy the returned device_key into include/device_secrets.h
 *
 * The firmware builds without that file, but every access request is then
 * refused by the backend with DEVICE_UNAUTHORIZED - it fails closed instead
 * of pretending to work.
 */

#if __has_include("device_secrets.h")
#include "device_secrets.h"
#endif

#ifndef DEVICE_UID
#define DEVICE_UID "SMARTBUS-DEV-01"
#warning "device_secrets.h not found: using a placeholder device id. Register the device and copy device_secrets.example.h to device_secrets.h."
#endif

#ifndef DEVICE_KEY
#define DEVICE_KEY ""
#endif

// Where the backend and the face service are reachable from the bus.
// Point this at the machine that runs `node backend/src/server.js`.
#ifndef BACKEND_HOST
#define BACKEND_HOST "10.95.164.74"
#endif

#ifndef BACKEND_PORT
#define BACKEND_PORT 5000
#endif

// The route this unit is operating on. The bus itself comes from the device
// registration on the backend, never from this file.
#ifndef BUS_ROUTE_ID
#define BUS_ROUTE_ID 1
#endif

// Timeouts (milliseconds). They bound how long one boarding attempt can take.
#ifndef HTTP_TIMEOUT_MS
#define HTTP_TIMEOUT_MS 8000
#endif

#ifndef FACE_TIMEOUT_MS
#define FACE_TIMEOUT_MS 12000
#endif

// How often the unit reports its position while a fix is fresh.
#ifndef GPS_REPORT_INTERVAL_MS
#define GPS_REPORT_INTERVAL_MS 15000
#endif

// A fix older than this is not reported as a position at all.
#ifndef GPS_MAX_FIX_AGE_MS
#define GPS_MAX_FIX_AGE_MS 120000
#endif

#ifndef BUZZER_ENABLED
#define BUZZER_ENABLED 1
#endif

// Feedback timing. The connected buzzer is an active-low module: LOW turns
// it on and HIGH turns it off. It is driven directly, not with LEDC, because
// the camera owns the LEDC timer/channel used during capture.
#ifndef RESULT_DISPLAY_MS
#define RESULT_DISPLAY_MS 3000
#endif

#ifndef DENIAL_BUZZER_MS
#define DENIAL_BUZZER_MS 1200
#endif

#ifndef EMERGENCY_BUZZER_MS
#define EMERGENCY_BUZZER_MS 3000
#endif
