/**
 * Device authentication for the ESP32 access-control units.
 *
 * A bus reader is not a user: it has no password and no session. It proves who
 * it is with a high-entropy key that is stored in the firmware configuration
 * and kept in the database only as a SHA-256 digest. The key also determines
 * which bus the device may report for, which is what stops one bus unit from
 * granting access on another bus.
 */

const crypto = require("node:crypto");
const db = require("../config/database");
const { PATTERNS } = require("../utils/validation");

function digest(value) {
    return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function safeEqualHex(left, right) {
    if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) {
        return false;
    }
    return crypto.timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/**
 * Resolve the device described by the request headers.
 * Returns null when the request is not from a known, active device.
 */
async function resolveDevice(req) {
    const deviceUid = req.get("X-Device-Id");
    const presentedKey = req.get("X-Device-Key");

    if (!deviceUid || !presentedKey) {
        return null;
    }

    if (!PATTERNS.deviceUid.test(deviceUid) || presentedKey.length < 32) {
        return null;
    }

    const [rows] = await db.query(
        `SELECT d.id, d.device_uid, d.bus_id, d.api_key_hash, d.status, b.bus_number, b.status AS bus_status
           FROM devices d
           JOIN buses b ON b.id = d.bus_id
          WHERE d.device_uid = ?
          LIMIT 1`,
        [deviceUid]
    );

    if (rows.length === 0) {
        return null;
    }

    const device = rows[0];

    if (!safeEqualHex(digest(presentedKey), device.api_key_hash)) {
        return null;
    }

    if (device.status !== "ACTIVE" || device.bus_status !== "ACTIVE") {
        return null;
    }

    return device;
}

function authenticateDevice({ requireActiveBus = true } = {}) {
    return async function deviceAuth(req, res, next) {
        try {
            const device = await resolveDevice(req);

            if (!device) {
                return res.status(401).json({
                    success: false,
                    error: "DEVICE_UNAUTHORIZED",
                    message: "This device is not registered or its key is not valid."
                });
            }

            if (requireActiveBus && device.bus_status !== "ACTIVE") {
                return res.status(403).json({
                    success: false,
                    error: "BUS_INACTIVE",
                    message: "The bus assigned to this device is not active."
                });
            }

            req.device = {
                id: device.id,
                device_uid: device.device_uid,
                bus_id: device.bus_id,
                bus_number: device.bus_number
            };

            // Best effort: a failed touch must not fail the request.
            db.query("UPDATE devices SET last_seen_at = NOW() WHERE id = ?", [device.id])
                .catch(() => {});

            return next();
        } catch (error) {
            return next(error);
        }
    };
}

function hashDeviceKey(key) {
    return digest(key);
}

function generateDeviceKey() {
    return crypto.randomBytes(32).toString("hex");
}

module.exports = {
    authenticateDevice,
    resolveDevice,
    hashDeviceKey,
    generateDeviceKey,
    digest
};
