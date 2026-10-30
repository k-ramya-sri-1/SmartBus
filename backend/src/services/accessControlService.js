/**
 * The access-control transaction.
 *
 * One call from the device produces exactly one access decision and exactly
 * one boarding record. The steps are ordered so that nothing can be granted
 * without evidence that the backend itself produced:
 *
 *   face token (single use) -> identity + permission checks -> GPS context
 *   -> route deviation -> boarding record -> real-time event
 *
 * If the record cannot be written, the answer is a refusal. A gate that opens
 * without an audit trail is worse than a gate that stays shut.
 */

const db = require("../config/database");
const config = require("../config/env");
const { evaluateAccess } = require("./authorizationService");
const {
    verifyToken,
    consumeToken,
    validateCameraOnlyProof,
    getVerificationByTokenId,
    getVerificationById
} = require("./faceTokenService");
const { evaluateRouteDeviation, isDeviationEnforced } = require("./routeDeviationService");
const { getSettings } = require("./settingsService");

const FACE_DECISION_TO_REASON = new Map([
    ["NO_FACE", "FACE_MISMATCH"],
    ["MULTIPLE_FACES", "FACE_MISMATCH"],
    ["LOW_SCORE", "FACE_MISMATCH"],
    ["DIFFERENT_STUDENT", "FACE_MISMATCH"],
    ["NOT_ENROLLED", "FACE_MISMATCH"],
    ["IMAGE_INVALID", "FACE_MISMATCH"],
    ["ENGINE_ERROR", "FACE_UNAVAILABLE"],
    ["ENGINE_UNAVAILABLE", "FACE_UNAVAILABLE"]
]);

function toFiniteOrNull(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

/**
 * Normalise whatever the device reported about its position.
 * A missing fix is reported as UNAVAILABLE; a stale fix as GPS_STALE. Neither
 * is ever converted into a coordinate.
 */
async function deriveGpsContext(gpsInput) {
    const settings = await getSettings();
    const maxAge = Number(settings.gps_max_fix_age_seconds) || 120;

    const latitude = toFiniteOrNull(gpsInput?.latitude);
    const longitude = toFiniteOrNull(gpsInput?.longitude);
    const ageSeconds = toFiniteOrNull(gpsInput?.age_seconds);
    const reportedStatus = typeof gpsInput?.fix_status === "string" ? gpsInput.fix_status : null;

    if (
        latitude === null || longitude === null ||
        latitude < -90 || latitude > 90 ||
        longitude < -180 || longitude > 180
    ) {
        return {
            status: "UNAVAILABLE",
            latitude: null,
            longitude: null,
            satellites: null,
            hdop: null,
            age_seconds: ageSeconds
        };
    }

    const satellites = toFiniteOrNull(gpsInput?.satellites);
    const hdop = toFiniteOrNull(gpsInput?.hdop);

    if (reportedStatus === "GPS_STALE" || (ageSeconds !== null && ageSeconds > maxAge)) {
        return {
            status: "GPS_STALE",
            latitude,
            longitude,
            satellites,
            hdop,
            age_seconds: ageSeconds
        };
    }

    return {
        status: "GPS_FIX",
        latitude,
        longitude,
        satellites,
        hdop,
        age_seconds: ageSeconds
    };
}

async function resolveFaceContext({ faceProof, faceVerificationId, device, authenticationMode = "RFID" }) {
    if (!faceProof) {
        // A failed verification has no proof to present. The device may send the
        // verification id so the denial is recorded with its real reason.
        // A "MATCH" record can never be redeemed this way: approving access
        // always requires the single-use proof itself.
        if (faceVerificationId) {
            const verification = await getVerificationById(faceVerificationId);

            if (!verification) {
                return {
                    status: "FAILED",
                    code: "FACE_TOKEN_INVALID",
                    message: "The face verification record does not exist.",
                    decision: "FACE_TOKEN_INVALID"
                };
            }

            if (Number(verification.device_id) !== Number(device.id)) {
                return {
                    status: "FAILED",
                    code: "FACE_TOKEN_INVALID",
                    message: "The face verification was performed on a different device.",
                    decision: "FACE_TOKEN_INVALID"
                };
            }

            if (verification.decision === "MATCH") {
                return {
                    status: "FAILED",
                    code: "FACE_TOKEN_INVALID",
                    message: "A matched verification must be redeemed with its single-use proof.",
                    decision: "FACE_TOKEN_INVALID"
                };
            }

            return {
                status: "FAILED",
                code: "FACE_NOT_MATCHED",
                decision: verification.decision,
                verification,
                message: "The captured face did not match the registered student."
            };
        }

        return { status: "MISSING" };
    }

    if (authenticationMode === "CAMERA_ONLY") {
        try {
            const validated = await validateCameraOnlyProof({
                token: faceProof,
                deviceId: device.id
            });
            return {
                status: "VERIFIED",
                claims: validated.claims,
                verification: validated.verification,
                authenticationMode: "CAMERA_ONLY"
            };
        } catch (error) {
            return {
                status: "FAILED",
                code: error.code || "FACE_TOKEN_INVALID",
                message: error.message,
                decision: error.code === "FACE_TOKEN_REUSED" ? "FACE_TOKEN_REUSED" : "FACE_TOKEN_INVALID"
            };
        }
    }

    let claims;

    try {
        claims = verifyToken(faceProof);
    } catch (error) {
        return {
            status: "FAILED",
            code: error.code || "FACE_TOKEN_INVALID",
            message: error.message,
            decision: "FACE_TOKEN_INVALID"
        };
    }

    const verification = await getVerificationByTokenId(claims.jti);

    if (!verification) {
        return {
            status: "FAILED",
            code: "FACE_TOKEN_INVALID",
            message: "The face verification record does not exist.",
            decision: "FACE_TOKEN_INVALID"
        };
    }

    if (verification.decision !== "MATCH") {
        return {
            status: "FAILED",
            code: "FACE_NOT_MATCHED",
            decision: verification.decision,
            message: "The captured face did not match the registered student."
        };
    }

    const tokenMode = claims.mode || "RFID";

    if (tokenMode !== authenticationMode || verification.authentication_mode !== tokenMode) {
        return {
            status: "FAILED",
            code: "FACE_TOKEN_INVALID",
            message: "The face verification mode does not match the proof.",
            decision: "FACE_TOKEN_INVALID"
        };
    }

    if (Number(verification.device_id) !== Number(device.id)) {
        return {
            status: "FAILED",
            code: "FACE_TOKEN_INVALID",
            message: "The face verification was performed on a different device.",
            decision: "FACE_TOKEN_INVALID"
        };
    }

    if (verification.used_at) {
        return {
            status: "FAILED",
            code: "FACE_TOKEN_REUSED",
            message: "This face verification has already been used or has expired.",
            decision: "FACE_TOKEN_REUSED"
        };
    }

    return { status: "VERIFIED", claims, verification, authenticationMode: tokenMode };
}

async function findExistingRecord(clientEventId, deviceId, authenticationMode) {
    if (!clientEventId) {
        return null;
    }

    const [rows] = await db.query(
        `SELECT id, access_result, denial_reason, boarding_type, authentication_mode,
                boarded_at, student_id, bus_id, route_id
           FROM boarding_records
          WHERE client_event_id = ?
            AND device_id = ?
            AND authentication_mode = ?
          LIMIT 1`,
        [clientEventId, deviceId, authenticationMode]
    );

    return rows[0] || null;
}

function buildRecord(decision, { device, routeId, faceContext, gps, clientEventId, authenticationMode = "RFID" }) {
    return {
        student_id: decision.student ? decision.student.id : null,
        attempted_rfid_uid: decision.card ? decision.card.uid : (decision.attempted_rfid_uid || null),
        bus_id: device.bus_id,
        route_id: decision.route ? decision.route.id : routeId || null,
        device_id: device.id,
        authentication_mode: faceContext.authenticationMode || authenticationMode,
        rfid_card_id: decision.card ? decision.card.id : null,
        temporary_authorization_id: decision.temporary_authorization_id || null,
        face_verification_id: faceContext.verification ? faceContext.verification.id : null,
        rfid_verified: Boolean(decision.card && decision.card.status === "ACTIVE"),
        face_verified: faceContext.status === "VERIFIED",
        face_score: faceContext.verification ? faceContext.verification.score : null,
        gps_status: gps.status,
        route_deviation_m: decision.route_deviation ? decision.route_deviation.distance_m : null,
        access_result: decision.authorized ? "GRANTED" : "DENIED",
        denial_reason: decision.authorized ? null : decision.denial_reason,
        boarding_type: decision.boarding_type || "NORMAL",
        client_event_id: clientEventId || null
    };
}

async function insertRecord(record, decision, faceContext) {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        if (faceContext.status === "VERIFIED" && !(await consumeToken(faceContext.claims.jti, connection))) {
            await connection.rollback();
            return null;
        }

        const [result] = await connection.query(
            `INSERT INTO boarding_records
                (student_id, attempted_rfid_uid, bus_id, route_id, device_id, authentication_mode, rfid_card_id,
                 temporary_authorization_id, face_verification_id, rfid_verified, face_verified,
                 face_score, gps_status, route_deviation_m, access_result, denial_reason,
                 boarding_type, client_event_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                record.student_id,
                record.attempted_rfid_uid,
                record.bus_id,
                record.route_id,
                record.device_id,
                record.authentication_mode,
                record.rfid_card_id,
                record.temporary_authorization_id,
                record.face_verification_id,
                record.rfid_verified,
                record.face_verified,
                record.face_score,
                record.gps_status,
                record.route_deviation_m,
                record.access_result,
                record.denial_reason,
                record.boarding_type,
                record.client_event_id
            ]
        );

        if (decision.authorized && record.temporary_authorization_id) {
            const [temporaryResult] = await connection.query(
                "UPDATE temporary_authorizations SET status = 'USED' WHERE id = ? AND status = 'ACTIVE'",
                [record.temporary_authorization_id]
            );

            if (temporaryResult.affectedRows !== 1) {
                throw new Error("Temporary authorization was already consumed.");
            }

            await connection.query(
                `UPDATE rescue_allocations
                    SET allocation_status = 'BOARDED'
                  WHERE id = (
                      SELECT rescue_allocation_id FROM temporary_authorizations WHERE id = ?
                  )
                    AND allocation_status = 'ALLOCATED'`,
                [record.temporary_authorization_id]
            );
        }

        await connection.commit();
        return result.insertId;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * @returns {object} the decision, augmented with logging information
 */
async function processAccess(params) {
    const lockConnection = await db.getConnection();
    const lockName = `smartbus:access:${Number(params.device.bus_id)}`;

    try {
        const [rows] = await lockConnection.query("SELECT GET_LOCK(?, 10) AS acquired", [lockName]);

        if (Number(rows[0]?.acquired) !== 1) {
            const error = new Error("The bus access lock could not be acquired.");
            error.code = "ACCESS_BUSY";
            error.statusCode = 503;
            throw error;
        }

        return await processAccessUnlocked(params);
    } finally {
        await lockConnection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
        lockConnection.release();
    }
}

async function processAccessUnlocked({
    device,
    rfidUid,
    routeId,
    faceProof,
    faceVerificationId,
    clientEventId,
    gpsInput,
    io,
    authenticationMode = "RFID"
}) {
    // Idempotency: a retried scan must not create a second grant.
    const existing = await findExistingRecord(clientEventId, device.id, authenticationMode);

    if (existing) {
        return {
            authorized: existing.access_result === "GRANTED",
            duplicate: true,
            denial_reason: existing.denial_reason,
            display_reason: existing.access_result === "GRANTED" ? "GRANTED" : "DENIED",
            message: "This scan was already processed.",
            boarding_record_id: existing.id,
            boarding_type: existing.boarding_type,
            authentication_mode: existing.authentication_mode || "RFID",
            boarded_at: existing.boarded_at
        };
    }

    const faceContext = await resolveFaceContext({
        faceProof,
        faceVerificationId,
        device,
        authenticationMode
    });
    const gps = await deriveGpsContext(gpsInput);

    let cameraStudent = null;

    if (authenticationMode === "CAMERA_ONLY" && faceContext.status === "VERIFIED") {
        const [students] = await db.query(
            `SELECT id, student_id AS code, name, status
               FROM students
              WHERE id = ?
              LIMIT 1`,
            [faceContext.verification.student_id]
        );
        cameraStudent = students[0] || null;
    }

    let decision = await evaluateAccess({
        device,
        rfidUid,
        routeId,
        faceContext,
        cameraStudent,
        authenticationMode
    });

    // Route deviation is advisory unless an operator enforces it. It can only
    // ever turn a grant into a refusal, never the other way round.
    if (decision.route && decision.route.id && gps.status === "GPS_FIX") {
        const deviation = await evaluateRouteDeviation({
            routeId: decision.route.id,
            latitude: gps.latitude,
            longitude: gps.longitude,
            gpsStatus: gps.status
        });

        decision.route_deviation = deviation;

        if (
            decision.authorized &&
            deviation.status === "DEVIATED" &&
            (await isDeviationEnforced())
        ) {
            decision = {
                ...decision,
                authorized: false,
                denial_reason: "ROUTE_DEVIATION",
                display_reason: "OFF ROUTE",
                message: `The bus is ${Math.round(deviation.distance_m)} m away from its configured route.`
            };
        }
    }

    const record = buildRecord(decision, {
        device,
        routeId,
        faceContext,
        gps,
        clientEventId,
        authenticationMode
    });

    let recordId;

    try {
        recordId = await insertRecord(record, decision, faceContext);

        if (recordId === null) {
            faceContext.status = "FAILED";
            faceContext.code = "FACE_TOKEN_REUSED";
            faceContext.decision = "FACE_TOKEN_REUSED";
            faceContext.message = "This face verification has already been used or has expired.";
            decision = await evaluateAccess({
                device,
                rfidUid,
                routeId,
                faceContext,
                cameraStudent,
                authenticationMode
            });
            const retryRecord = buildRecord(decision, {
                device,
                routeId,
                faceContext,
                gps,
                clientEventId,
                authenticationMode
            });
            recordId = await insertRecord(retryRecord, decision, faceContext);
            if (recordId === null) {
                throw new Error("Could not persist the replay denial.");
            }
            return {
                ...decision,
                boarding_record_id: recordId,
                authentication_mode: authenticationMode,
                duplicate: false
            };
        }
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY" && clientEventId) {
            const duplicate = await findExistingRecord(clientEventId, device.id, authenticationMode);

            if (duplicate) {
                return {
                    authorized: duplicate.access_result === "GRANTED",
                    duplicate: true,
                    denial_reason: duplicate.denial_reason,
                    display_reason: duplicate.access_result === "GRANTED" ? "GRANTED" : "DENIED",
                    message: "This scan was already processed.",
                    boarding_record_id: duplicate.id,
                    boarding_type: duplicate.boarding_type,
                    authentication_mode: duplicate.authentication_mode || "RFID",
                    boarded_at: duplicate.boarded_at
                };
            }

            const conflict = new Error("This client event ID belongs to another device or authentication mode.");
            conflict.statusCode = 409;
            conflict.code = "IDEMPOTENCY_CONFLICT";
            throw conflict;
        }

        console.error("Failed to persist boarding record:", error.message);

        return {
            authorized: false,
            denial_reason: "SYSTEM_ERROR",
            display_reason: "SYSTEM ERROR",
            message: "The access attempt could not be recorded, so access was not granted.",
            boarding_record_id: null,
            boarding_type: "NORMAL",
            authentication_mode: authenticationMode,
            error: "BOARDING_RECORD_FAILED"
        };
    }

    const payload = {
        authorized: decision.authorized,
        denial_reason: decision.denial_reason,
        display_reason: decision.display_reason,
        message: decision.message,
        boarding_record_id: recordId,
        boarding_type: record.boarding_type,
        authentication_mode: record.authentication_mode,
        student: decision.student
            ? { id: decision.student.id, code: decision.student.code, name: decision.student.name }
            : null,
        bus: decision.bus || { id: device.bus_id, number: device.bus_number },
        route: decision.route
            ? { id: decision.route.id, name: decision.route.route_name }
            : null,
        rfid_verified: record.rfid_verified,
        face_verified: record.face_verified,
        face_score: record.face_score,
        face_decision: faceContext.verification ? faceContext.verification.decision : (faceContext.decision || null),
        gps_status: gps.status,
        route_deviation: decision.route_deviation || null,
        authorization_source: decision.authorization_source || null,
        capacity: decision.capacity || null,
        device: { id: device.id, device_uid: device.device_uid, bus_id: device.bus_id }
    };

    if (io) {
        io.emit("access_event", {
            boarding_record_id: recordId,
            student: payload.student,
            bus: payload.bus,
            result: record.access_result,
            denial_reason: record.denial_reason,
            boarding_type: record.boarding_type,
            face_verified: record.face_verified,
            gps_status: record.gps_status,
            boarded_at: new Date().toISOString()
        });
    }

    return payload;
}

module.exports = {
    processAccess,
    deriveGpsContext,
    resolveFaceContext,
    FACE_DECISION_TO_REASON,
    faceTokenTtlSeconds: config.faceTokenTtlSeconds
};
