#pragma once

/**
 * Local feedback: OLED, LEDs and buzzer.
 *
 * The OLED is a status display, not an access decision. The white LED means
 * "the backend granted access", the red LED means "denied or degraded", and
 * the buzzer signals denials and emergencies.
 */

#include <Arduino.h>

namespace ui_display {

enum class State {
    Boot,
    Ready,
    Scanning,
    Verifying,
    Granted,
    Denied,
    Emergency,
    Fault
};

/** Initialise the display and the indicators. */
bool begin();

/** Drive the blinking/pattern logic; call every loop iteration. */
void poll();

void showBoot(const String& line);
void showReady();
void showScanning(const String& uid);
void showVerifying(const String& name);
void showGranted(const String& name);
void showDenied(const String& reason);
void showEmergency(const String& status);
void showFault(const String& component, const String& detail);

/** Timed denial/emergency alerts. No-op when the buzzer is disabled. */
void beepDenied();
void beepEmergency();

/** Overlay line for the status bar (Wi-Fi / GPS). */
void setConnectivity(bool wifiUp, bool gpsFresh);

} // namespace ui_display
