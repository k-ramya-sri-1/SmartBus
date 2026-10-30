/**
 * Access decision engine.
 *
 * Order of checks (the same order the report describes in section 4.15):
 *   1. the RFID card must exist and be active
 *   2. the student must be active
 *   3. the face must have been verified by the backend for *this* student,
 *      *this* card and *this* device
 *   4. the bus and route must be operational
 *   5. the student must be permitted on that bus and route, either by their
 *      permanent assignment, by a temporary authorization (missed bus, rescue,
 *      other), or by an active Fest Mode
 *
 * `evaluateAccess` returns a decision and writes nothing. Logging is the
 * caller's responsibility, so a failed insert can never become an open gate.
 */

const db = require("../config/database");
const { getOperatingMode } = require("./settingsService");
const { getBusCapacity } = require("./capacityService");

/**
 * Short uppercase reason for the OLED (16 characters max per line).
 * Built with Map#set so the reason codes stay next to their display text.
 */
const DISPLAY_LABELS = new Map();

DISPLAY_LABELS.set("INVALID_RFID", "INVALID CARD");
DISPLAY_LABELS.set("STUDENT_INACTIVE", "CARD INACTIVE");
DISPLAY_LABELS.set("FACE_MISMATCH", "FACE MISMATCH");
DISPLAY_LABELS.set("FACE_NOT_PERFORMED", "FACE NOT DONE");
DISPLAY_LABELS.set("FACE_INVALID", "FACE INVALID");
DISPLAY_LABELS.set("FACE_UNAVAILABLE", "FACE SVC DOWN");
DISPLAY_LABELS.set("FACE_TIMEOUT", "FACE TIMEOUT");
DISPLAY_LABELS.set("WRONG_BUS", "WRONG BUS");
DISPLAY_LABELS.set("INVALID_ROUTE", "WRONG ROUTE");
DISPLAY_LABELS.set("NO_AUTHORIZATION", "NOT PERMITTED");
DISPLAY_LABELS.set("ROUTE_DEVIATION", "OFF ROUTE");
DISPLAY_LABELS.set("DEVICE_UNAUTHORIZED", "DEVICE BLOCKED");
DISPLAY_LABELS.set("SYSTEM_ERROR", "SYSTEM ERROR");

function displayReason(reason) {
    return DISPLAY_LABELS.get(reason) || "DENIED";
}

function deny(reason, message, extra = {}) {
    return {
        authorized: false,
        denial_reason: reason,
        display_reason: displayReason(reason),
        message,
        boarding_type: "NORMAL",
        temporary_authorization_id: null,
        assignment_id: null,
        ...extra
    };
}

async function findCardAndStudent(rfidUid, executor = db) {
    const [rows] = await executor.query(
        `SELECT
            r.id AS rfid_card_id,
            r.rfid_uid,
            r.status AS rfid_status,
            s.id AS student_id,
            s.student_id AS student_code,
            s.name AS student_name,
            s.status AS student_status
         FROM rfid_cards r
         JOIN students s ON s.id = r.student_id
         WHERE r.rfid_uid = ?
         LIMIT 1`,
        [rfidUid]
    );

    return rows[0] || null;
}

async function findActiveAssignment(studentId, executor = db) {
    const [rows] = await executor.query(
        `SELECT ba.id, ba.bus_id, ba.route_id, ba.assignment_status, ba.valid_from, ba.valid_to
           FROM bus_assignments ba
          WHERE ba.student_id = ?
            AND ba.assignment_status = 'ACTIVE'
            AND CURDATE() >= ba.valid_from
            AND (ba.valid_to IS NULL OR CURDATE() <= ba.valid_to)
          ORDER BY ba.id DESC
          LIMIT 1`,
        [studentId]
    );

    return rows[0] || null;
}

async function findUsableTemporaryAuthorization(studentId, busId, routeId, executor = db) {
    const [rows] = await executor.query(
        `SELECT ta.id, ta.temporary_bus_id, ta.route_id, ta.authorization_type,
                ta.valid_until, ta.rescue_allocation_id, ra.allocation_status
           FROM temporary_authorizations ta
           LEFT JOIN rescue_allocations ra ON ra.id = ta.rescue_allocation_id
          WHERE ta.student_id = ?
            AND ta.status = 'ACTIVE'
            AND ta.temporary_bus_id = ?
            AND (ta.route_id IS NULL OR ta.route_id = ?)
            AND (ta.valid_until IS NULL OR ta.valid_until > NOW())
            AND (ra.id IS NULL OR ra.allocation_status IN ('ALLOCATED', 'BOARDED'))
          ORDER BY ta.id DESC
          LIMIT 1`,
        [studentId, busId, routeId]
    );

    return rows[0] || null;
}

async function busServesRoute(busId, routeId, executor = db) {
    const [rows] = await executor.query(
        `SELECT 1
           FROM bus_routes
          WHERE bus_id = ?
            AND route_id = ?
            AND status = 'ACTIVE'
          LIMIT 1`,
        [busId, routeId]
    );

    return rows.length > 0;
}

async function findRoute(routeId, executor = db) {
    const [rows] = await executor.query(
        "SELECT id, route_name, destination, status FROM routes WHERE id = ? LIMIT 1",
        [routeId]
    );

    return rows[0] || null;
}

/**
 * @param {object} params
 * @param {{id:number, bus_id:number, bus_number:string}} params.device
 * @param {string} [params.rfidUid]
 * @param {number} params.routeId
 * @param {{id:number, code:string, name:string, status:string}} [params.cameraStudent]
 * @param {{status:string, claims?:object, decision?:string, code?:string, message?:string}} params.faceContext
 */
async function evaluateResolvedStudent({ device, routeId, faceContext, student, card = null, executor = db }) {
    if (!student) {
        return deny("FACE_NOT_PERFORMED", "A valid camera-only proof is required.");
    }

    if (card && card.status !== "ACTIVE") {
        return deny("INVALID_RFID", `RFID card is ${String(card.status).toLowerCase()}.`, { student, card });
    }

    if (student.status !== "ACTIVE") {
        return deny("STUDENT_INACTIVE", "This student account is not active.", { student, card });
    }

    // ---- 2. Face verification -----------------------------------------
    const faceFailure = checkFaceContext({ faceContext, student, card, device });

    if (faceFailure) {
        return deny(faceFailure.reason, faceFailure.message, { student, card });
    }

    // ---- 3. Bus and route ---------------------------------------------
    const route = await findRoute(routeId, executor);

    if (!route || route.status !== "ACTIVE") {
        return deny("INVALID_ROUTE", "This route is not active.", { student, card });
    }

    const bus = { id: Number(device.bus_id), number: device.bus_number };

    // ---- 4. Permanent assignment --------------------------------------
    const assignment = await findActiveAssignment(student.id, executor);

    if (assignment) {
        const sameBus = Number(assignment.bus_id) === Number(bus.id);
        const sameRoute = Number(assignment.route_id) === Number(route.id);

        if (sameBus && sameRoute) {
            return {
                authorized: true,
                denial_reason: null,
                display_reason: "GRANTED",
                message: "Access granted.",
                student,
                card,
                bus,
                route,
                boarding_type: "NORMAL",
                temporary_authorization_id: null,
                assignment_id: assignment.id,
                authorization_source: "ASSIGNMENT"
            };
        }
    }

    // ---- 5. Temporary authorization -----------------------------------
    const temporary = await findUsableTemporaryAuthorization(student.id, bus.id, route.id, executor);

    if (temporary) {
        return {
            authorized: true,
            denial_reason: null,
            display_reason: "GRANTED",
            message: "Access granted under a temporary authorization.",
            student,
            card,
            bus,
            route,
            boarding_type: "RESCUE",
            temporary_authorization_id: temporary.id,
            assignment_id: assignment ? assignment.id : null,
            authorization_source: temporary.authorization_type
        };
    }

    // ---- 6. Fest Mode --------------------------------------------------
    const festDecision = await evaluateFestAccess({ student, bus, route, executor });

    if (festDecision.allowed) {
        return {
            authorized: true,
            denial_reason: null,
            display_reason: "GRANTED",
            message: "Access granted under Fest Mode.",
            student,
            card,
            bus,
            route,
            boarding_type: "FEST",
            temporary_authorization_id: null,
            assignment_id: assignment ? assignment.id : null,
            authorization_source: "FEST_MODE",
            capacity: festDecision.capacity
        };
    }

    // ---- 7. Explain the refusal ---------------------------------------
    if (!assignment) {
        return deny("NO_AUTHORIZATION", "This student has no active bus permission.", {
            student, card, bus, route, fest_reason: festDecision.reason
        });
    }

    if (Number(assignment.bus_id) !== Number(bus.id)) {
        return deny("WRONG_BUS", "This student is not assigned to this bus.", {
            student, card, bus, route, fest_reason: festDecision.reason
        });
    }

    return deny("INVALID_ROUTE", "This student is not permitted on this route.", {
        student, card, bus, route, fest_reason: festDecision.reason
    });
}

async function evaluateAccess({ device, rfidUid, routeId, faceContext, cameraStudent, authenticationMode = "RFID", executor = db }) {
    if (cameraStudent) {
        return evaluateResolvedStudent({
            device,
            routeId,
            faceContext,
            student: cameraStudent,
            executor
        });
    }

    if (authenticationMode === "CAMERA_ONLY") {
        return deny(
            faceContext && faceContext.status === "FAILED" ? "FACE_INVALID" : "FACE_NOT_PERFORMED",
            faceContext?.message || "A valid camera-only proof is required."
        );
    }

    if (authenticationMode === "CAMERA_ONLY") {
        return deny(
            faceContext && faceContext.status === "FAILED" ? "FACE_INVALID" : "FACE_NOT_PERFORMED",
            faceContext?.message || "A valid camera-only proof is required."
        );
    }

    const record = await findCardAndStudent(rfidUid, executor);

    if (!record) {
        return deny("INVALID_RFID", "This RFID card is not registered.", {
            attempted_rfid_uid: rfidUid
        });
    }

    return evaluateResolvedStudent({
        device,
        routeId,
        faceContext,
        student: {
            id: record.student_id,
            code: record.student_code,
            name: record.student_name,
            status: record.student_status
        },
        card: { id: record.rfid_card_id, status: record.rfid_status, uid: record.rfid_uid },
        executor
    });
}

function checkFaceContext({ faceContext, student, card, device }) {
    if (!faceContext || faceContext.status === "MISSING") {
        return {
            reason: "FACE_NOT_PERFORMED",
            message: "Face verification is required before access can be granted."
        };
    }

    if (faceContext.status === "FAILED") {
        const decision = faceContext.decision || "";

        if (decision === "ENGINE_UNAVAILABLE") {
            return {
                reason: "FACE_UNAVAILABLE",
                message: "The face verification service is unavailable, so access cannot be granted."
            };
        }

        if (decision === "TIMEOUT") {
            return { reason: "FACE_TIMEOUT", message: "Face verification timed out." };
        }

        if (["FACE_TOKEN_INVALID", "FACE_TOKEN_EXPIRED", "FACE_TOKEN_REUSED"].includes(faceContext.code)) {
            return { reason: "FACE_INVALID", message: faceContext.message };
        }

        return { reason: "FACE_MISMATCH", message: faceContext.message || "Face verification failed." };
    }

    // status === "VERIFIED": the token must be bound to this exact attempt.
    const claims = faceContext.claims || {};

    if (Number(claims.sub) !== Number(student.id)) {
        return { reason: "FACE_INVALID", message: "The face verification belongs to a different student." };
    }

    if (claims.mode === "CAMERA_ONLY" && card) {
        return { reason: "FACE_INVALID", message: "A camera-only proof cannot be used with RFID authorization." };
    }

    if (claims.mode === "RFID" && !card) {
        return { reason: "FACE_INVALID", message: "An RFID proof is required for RFID authorization." };
    }

    if (!card) {
        if (Number(claims.dev) !== Number(device.id)) {
            return { reason: "FACE_INVALID", message: "The face verification was performed on a different device." };
        }
        return null;
    }

    if (Number(claims.card) !== Number(card.id)) {
        return { reason: "FACE_INVALID", message: "The face verification belongs to a different RFID card." };
    }

    if (Number(claims.dev) !== Number(device.id)) {
        return { reason: "FACE_INVALID", message: "The face verification was performed on a different device." };
    }

    return null;
}

async function evaluateFestAccess({ student, bus, route, executor = db }) {
    const mode = await getOperatingMode();

    if (!mode.active) {
        return { allowed: false, reason: mode.reason };
    }

    // Fest Mode relaxes *which bus* a student may take, not *which route*.
    const assignment = await findActiveAssignment(student.id, executor);
    const studentRouteId = assignment ? assignment.route_id : null;

    if (!studentRouteId) {
        return { allowed: false, reason: "Student has no active assignment to relax" };
    }

    if (Number(studentRouteId) !== Number(route.id)) {
        return { allowed: false, reason: "Fest Mode only covers the student's assigned route" };
    }

    if (!(await busServesRoute(bus.id, route.id, executor))) {
        return { allowed: false, reason: "This bus does not serve the route" };
    }

    const capacity = await getBusCapacity(bus.id, executor);

    if (!capacity || capacity.rescue_capacity <= 0) {
        return { allowed: false, reason: "This bus has no remaining capacity" };
    }

    return { allowed: true, reason: "Fest Mode permits this bus", capacity };
}

module.exports = {
    evaluateAccess,
    displayReason,
    findCardAndStudent,
    findActiveAssignment,
    findUsableTemporaryAuthorization,
    busServesRoute
};
