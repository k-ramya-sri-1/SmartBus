const db = require("../config/database");
const { asyncHandler } = require("../middleware/errors");
const { evaluateRouteDeviation } = require("../services/routeDeviationService");
const { getSettings } = require("../services/settingsService");
const { requireNumber, requireInt, optionalString } = require("../utils/validation");

const FIX_STATUSES = ["GPS_FIX", "GPS_STALE", "UNAVAILABLE"];

/**
 * Store one position reported by a bus unit.
 *
 * Rules:
 *   * the bus comes from the device credentials, not from the body
 *   * a position without coordinates is rejected, never stored as 0,0
 *   * a fix older than the configured age is stored as GPS_STALE
 *   * deviation from the configured route is computed here when the route has
 *     waypoints, and left as null when it does not
 */
const createGPSLocation = asyncHandler(async (req, res) => {
    const busId = Number(req.device.bus_id);

    const latitude = requireNumber(req.body.latitude, "latitude", { min: -90, max: 90 });
    const longitude = requireNumber(req.body.longitude, "longitude", { min: -180, max: 180 });

    const speed = req.body.speed === undefined || req.body.speed === null || req.body.speed === ""
        ? null
        : requireNumber(req.body.speed, "speed", { min: 0, max: 500 });

    const satellites = req.body.satellites === undefined || req.body.satellites === null
        ? null
        : requireInt(req.body.satellites, "satellites", { min: 0, max: 64 });

    const hdop = req.body.hdop === undefined || req.body.hdop === null
        ? null
        : requireNumber(req.body.hdop, "hdop", { min: 0, max: 100 });

    const settings = await getSettings();
    const maxAge = Number(settings.gps_max_fix_age_seconds) || 120;

    const ageSeconds = req.body.age_seconds === undefined || req.body.age_seconds === null
        ? null
        : requireNumber(req.body.age_seconds, "age_seconds", { min: 0, max: 86400 });

    const reportedStatus = optionalString(req.body.fix_status, "fix_status", { max: 20 });

    let fixStatus = "GPS_FIX";

    if (reportedStatus === "GPS_STALE" || (ageSeconds !== null && ageSeconds > maxAge)) {
        fixStatus = "GPS_STALE";
    }

    if (reportedStatus && !FIX_STATUSES.includes(reportedStatus)) {
        // Unknown values are not silently accepted as a valid fix.
        fixStatus = "GPS_STALE";
    }

    // Which route is this bus currently serving?
    const [busRoutes] = await db.query(
        `SELECT route_id
           FROM bus_routes
          WHERE bus_id = ? AND status = 'ACTIVE'
          ORDER BY id ASC
          LIMIT 1`,
        [busId]
    );

    const routeId = busRoutes.length > 0 ? busRoutes[0].route_id : null;

    let deviation = null;

    if (routeId) {
        deviation = await evaluateRouteDeviation({
            routeId,
            latitude,
            longitude,
            gpsStatus: fixStatus
        });
    }

    const sourceTime = req.body.source_time ? new Date(req.body.source_time) : null;
    const safeSourceTime = sourceTime && !Number.isNaN(sourceTime.getTime()) ? sourceTime : null;

    const [result] = await db.query(
        `INSERT INTO gps_locations
            (bus_id, latitude, longitude, speed, fix_status, satellites, hdop,
             source_time, route_deviation_m, device_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            busId,
            latitude,
            longitude,
            speed,
            fixStatus,
            satellites,
            hdop,
            safeSourceTime,
            deviation && deviation.distance_m !== null ? deviation.distance_m : null,
            req.device.id
        ]
    );

    const [buses] = await db.query(
        "SELECT id, bus_number, registration_number FROM buses WHERE id = ? LIMIT 1",
        [busId]
    );

    const bus = buses[0];

    const payload = {
        id: result.insertId,
        bus_id: busId,
        bus_number: bus ? bus.bus_number : null,
        registration_number: bus ? bus.registration_number : null,
        latitude,
        longitude,
        speed,
        fix_status: fixStatus,
        satellites,
        hdop,
        route_deviation: deviation,
        recorded_at: new Date().toISOString()
    };

    const io = req.app.get("io");

    if (io) {
        io.emit("gps_update", payload);
    }

    return res.status(201).json({
        success: true,
        message: fixStatus === "GPS_FIX"
            ? "GPS location stored."
            : "Location stored but flagged as not a current fix.",
        id: result.insertId,
        location: payload
    });
});

const getLatestGPSLocation = asyncHandler(async (req, res) => {
    const busId = requireInt(req.params.bus_id, "bus_id", { min: 1 });

    const [locations] = await db.query(
        `SELECT gl.id, gl.bus_id, b.bus_number, b.registration_number,
                gl.latitude, gl.longitude, gl.speed, gl.fix_status,
                gl.satellites, gl.hdop, gl.route_deviation_m, gl.recorded_at
           FROM gps_locations gl
           JOIN buses b ON gl.bus_id = b.id
          WHERE gl.bus_id = ?
          ORDER BY gl.recorded_at DESC, gl.id DESC
          LIMIT 1`,
        [busId]
    );

    if (locations.length === 0) {
        return res.status(404).json({
            success: false,
            error: "NO_GPS_DATA",
            message: "No GPS location has been recorded for this bus."
        });
    }

    const location = locations[0];
    const settings = await getSettings();
    const maxAge = Number(settings.gps_max_fix_age_seconds) || 120;
    const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(location.recorded_at).getTime()) / 1000));

    return res.json({
        success: true,
        location: {
            ...location,
            age_seconds: ageSeconds,
            // A position the dashboard can trust, and nothing more.
            is_current: location.fix_status === "GPS_FIX" && ageSeconds <= maxAge
        }
    });
});

const getGPSHistory = asyncHandler(async (req, res) => {
    const busId = requireInt(req.params.bus_id, "bus_id", { min: 1 });
    const limit = req.query.limit === undefined
        ? 200
        : requireInt(req.query.limit, "limit", { min: 1, max: 1000 });

    const [locations] = await db.query(
        `SELECT gl.id, gl.bus_id, b.bus_number, gl.latitude, gl.longitude, gl.speed,
                gl.fix_status, gl.satellites, gl.hdop, gl.route_deviation_m, gl.recorded_at
           FROM gps_locations gl
           JOIN buses b ON gl.bus_id = b.id
          WHERE gl.bus_id = ?
          ORDER BY gl.recorded_at DESC, gl.id DESC
          LIMIT ?`,
        [busId, limit]
    );

    return res.json({
        success: true,
        count: locations.length,
        locations
    });
});

module.exports = {
    createGPSLocation,
    getLatestGPSLocation,
    getGPSHistory
};
