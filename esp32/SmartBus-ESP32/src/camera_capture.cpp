#include "camera_capture.h"

#include "esp_camera.h"

#include "../include/board_pins.h"

namespace {

camera_config_t cameraConfig() {
    camera_config_t config = {};
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer = LEDC_TIMER_0;
    config.pin_d0 = PIN_CAM_D0;
    config.pin_d1 = PIN_CAM_D1;
    config.pin_d2 = PIN_CAM_D2;
    config.pin_d3 = PIN_CAM_D3;
    config.pin_d4 = PIN_CAM_D4;
    config.pin_d5 = PIN_CAM_D5;
    config.pin_d6 = PIN_CAM_D6;
    config.pin_d7 = PIN_CAM_D7;
    config.pin_xclk = PIN_CAM_XCLK;
    config.pin_pclk = PIN_CAM_PCLK;
    config.pin_vsync = PIN_CAM_VSYNC;
    config.pin_href = PIN_CAM_HREF;
    config.pin_sccb_sda = PIN_CAM_SIOD;
    config.pin_sccb_scl = PIN_CAM_SIOC;
    config.pin_pwdn = -1;
    config.pin_reset = -1;
    config.xclk_freq_hz = 20'000'000;
    config.pixel_format = PIXFORMAT_JPEG;
    // QVGA at quality 12 is roughly 10-20 KB: enough detail for a face at
    // boarding distance, small enough for a reliable HTTP upload.
    config.frame_size = FRAMESIZE_QVGA;
    config.jpeg_quality = 12;
    config.fb_count = 2;
    config.grab_mode = CAMERA_GRAB_LATEST;
    config.fb_location = CAMERA_FB_IN_PSRAM;
    return config;
}

bool ready = false;

} // namespace

namespace camera_capture {

bool begin() {
    camera_config_t config = cameraConfig();

    const esp_err_t err = esp_camera_init(&config);

    if (err != ESP_OK) {
        Serial.printf("Camera init failed: 0x%x\n", err);
        ready = false;
        return false;
    }

    sensor_t* sensor = const_cast<sensor_t*>(esp_camera_sensor_get());

    if (sensor != nullptr) {
        // Face verification works best with predictable exposure.
        sensor->set_aec2(sensor, 1);
        sensor->set_gainceiling(sensor, GAINCEILING_8X);
    }

    ready = true;
    Serial.println("Camera ready (QVGA JPEG, PSRAM frame buffer)");
    return true;
}

bool isReady() {
    return ready;
}

Capture grab() {
    Capture capture;
    capture.error = CaptureError::None;
    capture.handle = nullptr;
    capture.data = nullptr;
    capture.length = 0;

    if (!ready) {
        capture.error = CaptureError::NotInitialised;
        return capture;
    }

    // Discard the first frame so auto-exposure settles after idle time.
    for (int attempt = 0; attempt < 2; attempt++) {
        camera_fb_t* frame = esp_camera_fb_get();

        if (frame == nullptr) {
            capture.error = CaptureError::FrameTimeout;
            return capture;
        }

        if (attempt == 0) {
            esp_camera_fb_return(frame);
            continue;
        }

        if (frame->len == 0 || frame->buf == nullptr) {
            esp_camera_fb_return(frame);
            capture.error = CaptureError::EmptyFrame;
            return capture;
        }

        capture.handle = frame;
        capture.data = frame->buf;
        capture.length = frame->len;
        return capture;
    }

    capture.error = CaptureError::FrameTimeout;
    return capture;
}

void release(const Capture& capture) {
    if (capture.handle != nullptr) {
        esp_camera_fb_return(static_cast<camera_fb_t*>(capture.handle));
    }
}

} // namespace camera_capture
