const db = require("../config/database");
const { asyncHandler } = require("../middleware/errors");
const {
    requireInt,
    requireEnum,
    requireNumber,
    optionalString,
    ValidationError
} = require("../utils/validation");

const EVENT_TYPES = ["SOS", "BREAKDOWN", "ACCIDENT", "OTHER"];
const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED"];

function optionalCoordinate(value, field, min, max) {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    return requireNumber(value, field, { min, max });
}

/**
 * Report an emergency.
 *
 * A bus unit sends this when the SOS button is pressed. If the GPS has no fix
 * the coordinates are genuinely unknown: the event is stored with a NULL
 * position and location_status = UNAVAILABLE, because (0,0) would point rescue
 * services at the Gulf of Guinea.
 */
const createEmergencyEvent = asyncHandler(async (req, res) => {
    const isDevice = req.authType === "DEVICE";

    const busId = isDevice
        ? Number(req.device.bus_id)
        : requireInt(req.body.bus_id, "bus_id", { min: 1 });

    if (isDevice && req.body.bus_id !== undefined && Number(req.body.bus_id) !== busId) {
        throw new ValidationError(
            `This device is registered to bus ${busId}, not bus ${req.body.bus_id}`
        );
    }

    const eventType = requireEnum(req.body.event_type, "event_type", EVENT_TYPES);
    const description = optionalString(req.body.description, "description", { max: 2000 });

    const latitude = optionalCoordinate(req.body.latitude, "latitude", -90, 90);
    const longitude = optionalCoordinate(req.body.longitude, "longitude", -180, 180);

    if ((latitude === null) !== (longitude === null)) {
        throw new ValidationError("latitude and longitude must be provided together");
    }

    const locationStatus = latitude !== null && longitude !== null ? "GPS_FIX" : "UNAVAILABLE";

    const [buses] = await db.query(
        "SELECT id, bus_number, registration_number, maximum_capacity, status FROM buses WHERE id = ? LIMIT 1",
        [busId]
    );

    if (buses.length === 0) {
        return res.status(404).json({
            success: false,
            error: "BUS_NOT_FOUND",
            message: "Bus not found."
        });
    }

    const bus = buses[0];

    // Staff may report on behalf of a bus (driver app, control room). A device
    // cannot choose who reported it.
    let reportedByUserId = null;

    if (!isDevice) {
        reportedByUserId = req.user && req.user.id ? Number(req.user.id) : null;
    }

    const [result] = await db.query(
        `INSERT INTO emergency_events
            (bus_id, reported_by_user_id, device_id, event_type, description,
             latitude, longitude, location_status, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
        [
            busId,
            reportedByUserId,
            isDevice ? req.device.id : null,
            eventType,
            description,
            latitude,
            longitude,
            locationStatus
        ]
    );

    const [onBoard] = await db.query(
        `SELECT COUNT(DISTINCT student_id) AS count
           FROM boarding_records
          WHERE bus_id = ?
            AND access_result = 'GRANTED'
            AND student_id IS NOT NULL`,
        [busId]
    );

    const payload = {
        id: result.insertId,
        bus_id: bus.id,
        bus_number: bus.bus_number,
        event_type: eventType,
        description,
        latitude,
        longitude,
        location_status: locationStatus,
        status: "OPEN",
        students_on_board: Number(onBoard[0].count)
    };

    const io = req.app.get("io");

    if (io) {
        io.emit("emergency_event", payload);
    }

    return res.status(201).json({
        success: true,
        message: locationStatus === "GPS_FIX"
            ? "Emergency event created."
            : "Emergency event created without a position: the GPS had no fix.",
        emergency: payload
    });
});

const getAllEmergencyEvents = asyncHandler(async (req, res) => {
    const [events] = await db.query(
        `SELECT e.id, e.bus_id, b.bus_number, b.registration_number,
                e.reported_by_user_id, u.username AS reported_by, u.role AS reporter_role,
                e.device_id, e.event_type, e.description, e.latitude, e.longitude,
                e.location_status, e.status, e.created_at, e.resolved_at
           FROM emergency_events e
           JOIN buses b ON e.bus_id = b.id
           LEFT JOIN users u ON e.reported_by_user_id = u.id
          ORDER BY e.id DESC
          LIMIT 200`
    );

    return res.json({ success: true, count: events.length, events });
});

const getEmergencyEventById = asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, "id", { min: 1 });

    const [events] = await db.query(
        `SELECT e.id, e.bus_id, b.bus_number, b.registration_number,
                e.reported_by_user_id, u.username AS reported_by, u.role AS reporter_role,
                e.device_id, e.event_type, e.description, e.latitude, e.longitude,
                e.location_status, e.status, e.created_at, e.resolved_at
           FROM emergency_events e
           JOIN buses b ON e.bus_id = b.id
           LEFT JOIN users u ON e.reported_by_user_id = u.id
          WHERE e.id = ?`,
        [id]
    );

    if (events.length === 0) {
        return res.status(404).json({
            success: false,
            error: "EMERGENCY_NOT_FOUND",
            message: "Emergency event not found."
        });
    }

    return res.json({ success: true, emergency: events[0] });
});

const updateEmergencyStatus = asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, "id", { min: 1 });
    const status = requireEnum(req.body.status, "status", STATUSES);

    const [result] = await db.query(
        `UPDATE emergency_events
            SET status = ?,
                resolved_at = CASE WHEN ? IN ('RESOLVED', 'CANCELLED') THEN NOW() ELSE resolved_at END
          WHERE id = ?`,
        [status, status, id]
    );

    if (result.affectedRows === 0) {
        return res.status(404).json({
            success: false,
            error: "EMERGENCY_NOT_FOUND",
            message: "Emergency event not found."
        });
    }

    const io = req.app.get("io");

    if (io) {
        io.emit("emergency_status", { id, status });
    }

    return res.json({ success: true, message: "Emergency status updated.", id, status });
});

module.exports = {
    createEmergencyEvent,
    getAllEmergencyEvents,
    getEmergencyEventById,
    updateEmergencyStatus
};
