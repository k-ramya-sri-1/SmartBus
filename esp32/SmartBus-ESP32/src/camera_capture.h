#pragma once

/**
 * OV2640 camera capture.
 *
 * Capturing a frame is *not* face verification; it only produces the evidence
 * that the backend's face service compares against the enrolled student. Any
 * capture failure therefore denies access - it is never skipped.
 */

#include <Arduino.h>

namespace camera_capture {

enum class CaptureError {
    None,
    NotInitialised,
    FrameTimeout,
    EmptyFrame
};

struct Capture {
    CaptureError error;
    void* handle;          // driver frame-buffer handle, opaque here
    const uint8_t* data;   // valid until release()
    size_t length;
};

/** Initialise the camera with the verified pin map. */
bool begin();

/** True when the camera initialised successfully at boot. */
bool isReady();

/**
 * Grab one JPEG frame. The first frame after an idle period is discarded so
 * auto-exposure can settle; the returned frame is the second one.
 */
Capture grab();

/** Return the frame buffer (must be called after a successful grab). */
void release(const Capture& capture);

} // namespace camera_capture
