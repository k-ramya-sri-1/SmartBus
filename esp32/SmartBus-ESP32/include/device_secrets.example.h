#ifndef DEVICE_SECRETS_H
#define DEVICE_SECRETS_H

/**
 * Per-device identity for one ESP32 bus unit.
 *
 * 1. Register the device with an administrator account:
 *
 *      POST /api/devices
 *      { "device_uid": "SMARTBUS-BUS01-01", "bus_id": 1, "label": "Bus 1 reader" }
 *
 *    The response contains device_key exactly once.
 *
 * 2. Copy both values below and rebuild.
 *
 * 3. Rotate with POST /api/devices/<id>/rotate-key if the key is ever exposed;
 *    the old key stops working immediately.
 */

#define DEVICE_UID "SMARTBUS-BUS01-01"
#define DEVICE_KEY "0000000000000000000000000000000000000000000000000000000000000000"

#endif
