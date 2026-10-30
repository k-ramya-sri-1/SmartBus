/**
 * Device registry administration.
 *
 * Creating or rotating a device key returns the plaintext key exactly once;
 * the caller has to put it into the firmware configuration immediately.
 */

const { asyncHandler } = require("../middleware/errors");
const deviceService = require("../services/deviceService");
const {
    PATTERNS,
    requireString,
    requireInt,
    requireEnum,
    optionalString
} = require("../utils/validation");

const list = asyncHandler(async (req, res) => {
    const devices = await deviceService.listDevices();

    return res.json({
        success: true,
        count: devices.length,
        devices
    });
});

const create = asyncHandler(async (req, res) => {
    const deviceUid = requireString(req.body.device_uid, "device_uid", {
        min: 3, max: 64, pattern: PATTERNS.deviceUid
    });
    const busId = requireInt(req.body.bus_id, "bus_id", { min: 1 });
    const label = optionalString(req.body.label, "label", { max: 120 });
    const firmwareVersion = optionalString(req.body.firmware_version, "firmware_version", { max: 40 });

    const result = await deviceService.createDevice({
        deviceUid,
        busId,
        label,
        firmwareVersion,
        userId: req.user ? req.user.id : null
    });

    return res.status(201).json({
        success: true,
        message: "Device registered. Store the key in the firmware now: it cannot be shown again.",
        device: result.device,
        device_key: result.device_key
    });
});

const rotateKey = asyncHandler(async (req, res) => {
    const deviceId = requireInt(req.params.id, "id", { min: 1 });

    const result = await deviceService.rotateDeviceKey(deviceId);

    return res.json({
        success: true,
        message: "Device key rotated. The previous key no longer works.",
        device: result.device,
        device_key: result.device_key
    });
});

const updateStatus = asyncHandler(async (req, res) => {
    const deviceId = requireInt(req.params.id, "id", { min: 1 });
    const status = requireEnum(req.body.status, "status", ["ACTIVE", "INACTIVE", "REVOKED"]);

    const device = await deviceService.setDeviceStatus(deviceId, status);

    return res.json({
        success: true,
        message: `Device is now ${status}.`,
        device
    });
});

module.exports = {
    list,
    create,
    rotateKey,
    updateStatus
};
