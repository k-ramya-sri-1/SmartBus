/**
 * Device registry.
 *
 * A device key is shown exactly once, when the device is created or its key is
 * rotated. After that only its SHA-256 digest exists, so a database dump does
 * not hand an attacker the ability to impersonate a bus reader.
 */

const db = require("../config/database");
const { generateDeviceKey, hashDeviceKey } = require("../middleware/deviceAuth");

async function listDevices() {
    const [rows] = await db.query(
        `SELECT d.id, d.device_uid, d.bus_id, d.label, d.status, d.firmware_version,
                d.last_seen_at, d.created_at,
                b.bus_number, b.status AS bus_status
           FROM devices d
           JOIN buses b ON b.id = d.bus_id
          ORDER BY d.id ASC`
    );

    return rows;
}

async function getDeviceById(deviceId) {
    const [rows] = await db.query(
        `SELECT d.id, d.device_uid, d.bus_id, d.label, d.status, d.firmware_version,
                d.last_seen_at, d.created_at,
                b.bus_number, b.status AS bus_status
           FROM devices d
           JOIN buses b ON b.id = d.bus_id
          WHERE d.id = ?
          LIMIT 1`,
        [deviceId]
    );

    return rows[0] || null;
}

async function createDevice({ deviceUid, busId, label, firmwareVersion, userId }) {
    const [buses] = await db.query("SELECT id FROM buses WHERE id = ? LIMIT 1", [busId]);

    if (buses.length === 0) {
        const error = new Error("Bus not found");
        error.statusCode = 404;
        error.code = "BUS_NOT_FOUND";
        throw error;
    }

    const [existing] = await db.query("SELECT id FROM devices WHERE device_uid = ? LIMIT 1", [deviceUid]);

    if (existing.length > 0) {
        const error = new Error("A device with this identifier already exists");
        error.statusCode = 409;
        error.code = "DEVICE_EXISTS";
        throw error;
    }

    const plaintextKey = generateDeviceKey();

    const [result] = await db.query(
        `INSERT INTO devices (device_uid, bus_id, api_key_hash, label, firmware_version, created_by_user_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [deviceUid, busId, hashDeviceKey(plaintextKey), label || null, firmwareVersion || null, userId || null]
    );

    return {
        device: await getDeviceById(result.insertId),
        // Returned once and never retrievable again.
        device_key: plaintextKey
    };
}

async function rotateDeviceKey(deviceId) {
    const device = await getDeviceById(deviceId);

    if (!device) {
        const error = new Error("Device not found");
        error.statusCode = 404;
        error.code = "DEVICE_NOT_FOUND";
        throw error;
    }

    const plaintextKey = generateDeviceKey();

    await db.query("UPDATE devices SET api_key_hash = ? WHERE id = ?", [
        hashDeviceKey(plaintextKey),
        deviceId
    ]);

    return { device, device_key: plaintextKey };
}

async function setDeviceStatus(deviceId, status) {
    const [result] = await db.query("UPDATE devices SET status = ? WHERE id = ?", [status, deviceId]);

    if (result.affectedRows === 0) {
        const error = new Error("Device not found");
        error.statusCode = 404;
        error.code = "DEVICE_NOT_FOUND";
        throw error;
    }

    return getDeviceById(deviceId);
}

module.exports = {
    listDevices,
    getDeviceById,
    createDevice,
    rotateDeviceKey,
    setDeviceStatus
};
