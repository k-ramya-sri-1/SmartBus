const db = require("../config/database");
const { asyncHandler } = require("../middleware/errors");
const {
    requireInt,
    requireString,
    requireEnum,
    optionalString
} = require("../utils/validation");

/**
 * Create a boarding record manually.
 *
 * Normal traffic is written by the access-control endpoint, which carries the
 * face proof and the device identity. This route exists for an operator to
 * correct or annotate a record, and is restricted to management roles.
 */
const createBoardingRecord = asyncHandler(async (req, res) => {
    const studentId = requireInt(req.body.student_id, "student_id", { min: 1 });
    const busId = requireInt(req.body.bus_id, "bus_id", { min: 1 });
    const routeId = requireInt(req.body.route_id, "route_id", { min: 1 });

    const accessResult = requireEnum(req.body.access_result ?? "DENIED", "access_result", [
        "GRANTED",
        "DENIED"
    ]);

    const boardingType = requireEnum(req.body.boarding_type ?? "NORMAL", "boarding_type", [
        "NORMAL",
        "RESCUE",
        "FEST"
    ]);

    const denialReason = accessResult === "DENIED"
        ? optionalString(req.body.denial_reason ?? "OTHER", "denial_reason", { max: 40 })
        : null;

    const [students] = await db.query("SELECT id FROM students WHERE id = ? LIMIT 1", [studentId]);

    if (students.length === 0) {
        return res.status(404).json({
            success: false,
            error: "STUDENT_NOT_FOUND",
            message: "Student not found."
        });
    }

    const [buses] = await db.query("SELECT id FROM buses WHERE id = ? LIMIT 1", [busId]);

    if (buses.length === 0) {
        return res.status(404).json({
            success: false,
            error: "BUS_NOT_FOUND",
            message: "Bus not found."
        });
    }

    const [routes] = await db.query("SELECT id FROM routes WHERE id = ? LIMIT 1", [routeId]);

    if (routes.length === 0) {
        return res.status(404).json({
            success: false,
            error: "ROUTE_NOT_FOUND",
            message: "Route not found."
        });
    }

    const [result] = await db.query(
        `INSERT INTO boarding_records
            (student_id, bus_id, route_id, rfid_verified, face_verified, access_result,
             denial_reason, boarding_type)
         VALUES (?, ?, ?, 0, 0, ?, ?, ?)`,
        [studentId, busId, routeId, accessResult, denialReason, boardingType]
    );

    return res.status(201).json({
        success: true,
        message: "Boarding record created.",
        id: result.insertId
    });
});

const RECORD_COLUMNS = `
    br.id,
    br.student_id,
    s.student_id AS student_code,
    s.name AS student_name,
    br.attempted_rfid_uid,
    br.bus_id,
    b.bus_number,
    br.route_id,
    r.route_name,
    br.device_id,
    d.device_uid,
    br.authentication_mode,
    br.rfid_card_id,
    br.temporary_authorization_id,
    br.face_verification_id,
    br.rfid_verified,
    br.face_verified,
    br.face_score,
    br.gps_status,
    br.route_deviation_m,
    br.access_result,
    br.denial_reason,
    br.boarding_type,
    br.client_event_id,
    br.boarded_at
`;

/**
 * Every access attempt, including the ones that could not be attributed to a
 * student (an unknown card). Those rows have no student, which is exactly why
 * the joins are LEFT joins: an inner join would hide the most interesting
 * denials from the operator.
 */
const getAllBoardingRecords = asyncHandler(async (req, res) => {
    const limit = req.query.limit === undefined
        ? 200
        : requireInt(req.query.limit, "limit", { min: 1, max: 1000 });

    const [records] = await db.query(
        `SELECT ${RECORD_COLUMNS}
           FROM boarding_records br
           LEFT JOIN students s ON br.student_id = s.id
           LEFT JOIN buses b ON br.bus_id = b.id
           LEFT JOIN routes r ON br.route_id = r.id
           LEFT JOIN devices d ON br.device_id = d.id
          ORDER BY br.id DESC
          LIMIT ?`,
        [limit]
    );

    return res.json({
        success: true,
        count: records.length,
        records
    });
});

const getBoardingRecordById = asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, "id", { min: 1 });

    const [records] = await db.query(
        `SELECT ${RECORD_COLUMNS}
           FROM boarding_records br
           LEFT JOIN students s ON br.student_id = s.id
           LEFT JOIN buses b ON br.bus_id = b.id
           LEFT JOIN routes r ON br.route_id = r.id
           LEFT JOIN devices d ON br.device_id = d.id
          WHERE br.id = ?
          LIMIT 1`,
        [id]
    );

    if (records.length === 0) {
        return res.status(404).json({
            success: false,
            error: "RECORD_NOT_FOUND",
            message: "Boarding record not found."
        });
    }

    return res.json({ success: true, record: records[0] });
});

module.exports = {
    createBoardingRecord,
    getAllBoardingRecords,
    getBoardingRecordById
};
