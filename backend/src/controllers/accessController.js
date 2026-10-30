/**
 * Access-control endpoints used by the ESP32 bus units.
 *
 *   GET  /api/rfid/:uid              identify a card before the camera fires
 *   POST /api/face/verify            verify a captured frame, issue a token
 *   POST /api/authorization/check    decide + log one access attempt
 *
 * All three require device authentication. None of them accepts a client
 * claim about face verification: the token is the only evidence that counts.
 */

const { asyncHandler } = require("../middleware/errors");
const { findCardAndStudent, findActiveAssignment } = require("../services/authorizationService");
const faceTokenService = require("../services/faceTokenService");
const accessControlService = require("../services/accessControlService");
const faceServiceClient = require("../services/faceServiceClient");
const db = require("../config/database");
const {
    PATTERNS,
    requireString,
    requireInt,
    optionalString,
    optionalInt,
    ValidationError
} = require("../utils/validation");

/**
 * Card lookup. Kept on the path the previous firmware already used, but with
 * the bus/route context the device needs before it opens the camera.
 */
const lookupCard = asyncHandler(async (req, res) => {
    const uid = requireString(req.params.uid, "uid", { min: 4, max: 64, pattern: PATTERNS.rfidUid });

    const record = await findCardAndStudent(uid);

    if (!record) {
        return res.status(404).json({
            success: false,
            error: "INVALID_RFID",
            message: "This RFID card is not registered."
        });
    }

    const assignment = await findActiveAssignment(record.student_id);

    const [profiles] = await db.query(
        "SELECT verification_enabled, template_count FROM face_profiles WHERE student_id = ? LIMIT 1",
        [record.student_id]
    );

    const profile = profiles[0] || null;
    const faceReady = Boolean(profile && profile.verification_enabled && profile.template_count > 0);

    return res.json({
        success: true,
        student: {
            student_db_id: record.student_id,
            student_id: record.student_code,
            name: record.student_name,
            student_status: record.student_status
        },
        card: {
            rfid_card_id: record.rfid_card_id,
            rfid_uid: record.rfid_uid,
            rfid_status: record.rfid_status
        },
        assignment: assignment
            ? { bus_id: assignment.bus_id, route_id: assignment.route_id }
            : null,
        face_verification_required: true,
        face_ready: faceReady,
        // The gate may only consider a student whose profile can actually be
        // checked. Without templates the device shows FACE NOT ENROLLED.
        access_possible: record.student_status === "ACTIVE"
            && record.rfid_status === "ACTIVE"
            && faceReady
    });
});

function extractImage(req) {
    // Raw binary upload (what the ESP32 sends).
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        return req.body;
    }

    // JSON upload (what tooling and tests use).
    if (req.body && typeof req.body === "object") {
        const value = req.body.image;

        if (typeof value === "string" && value.length > 0) {
            const base64 = value.includes(",") ? value.split(",", 2)[1] : value;
            return Buffer.from(base64, "base64");
        }
    }

    return null;
}

/**
 * Verify the captured face against the student named by the RFID card.
 *
 * The RFID UID is the only identity input the device may provide; the student
 * is resolved server-side, so a device cannot ask "does this face look like
 * student 42?" and walk in with someone else's template.
 */
const verifyFace = asyncHandler(async (req, res) => {
    const rfidUidRaw = req.get("X-Rfid-Uid") || (req.body && !Buffer.isBuffer(req.body) ? req.body.rfid_uid : null);
    const rfidUid = requireString(rfidUidRaw, "rfid_uid", {
        min: 4, max: 64, pattern: PATTERNS.rfidUid
    });

    const image = extractImage(req);

    if (!image) {
        return res.status(400).json({
            success: false,
            error: "IMAGE_MISSING",
            message: "A JPEG or PNG image is required."
        });
    }

    const record = await findCardAndStudent(rfidUid);

    if (!record) {
        return res.status(403).json({
            success: false,
            error: "INVALID_RFID",
            decision: "INVALID_RFID",
            message: "This RFID card is not registered."
        });
    }

    if (record.rfid_status !== "ACTIVE") {
        return res.status(403).json({
            success: false,
            error: "INVALID_RFID",
            decision: "INVALID_RFID",
            message: "This RFID card is not active."
        });
    }

    if (record.student_status !== "ACTIVE") {
        return res.status(403).json({
            success: false,
            error: "STUDENT_INACTIVE",
            decision: "STUDENT_INACTIVE",
            message: "The student account is not active."
        });
    }

    const [profiles] = await db.query(
        "SELECT verification_enabled, template_count FROM face_profiles WHERE student_id = ? LIMIT 1",
        [record.student_id]
    );

    const profile = profiles[0] || null;
    const profileExists = Boolean(profile && profile.verification_enabled && profile.template_count > 0);

    const result = await faceTokenService.verifyAndIssue({
        studentId: record.student_id,
        rfidCardId: record.rfid_card_id,
        deviceId: req.device.id,
        expectedProfileExists: profileExists,
        imageBuffer: image
    });

    // A negative verification is a normal, expected outcome: HTTP 200 with
    // success:false so the device can display the reason instead of retrying.
    return res.status(result.success ? 200 : 403).json({
        success: result.success,
        decision: result.decision,
        message: result.success
            ? "Face verified. The access decision is still subject to bus and route rules."
            : (result.detail || "Face verification failed."),
        student: {
            student_db_id: record.student_id,
            student_id: record.student_code,
            name: record.student_name
        },
        rfid_card_id: record.rfid_card_id,
        face_proof: result.token,
        expires_in: result.token ? require("../config/env").faceTokenTtlSeconds : null,
        score: result.score,
        verification_id: result.verification_id
    });
});

/**
 * Identify a face without an RFID claim. This endpoint returns only an
 * identity candidate; bus access remains outside this Phase 1 operation.
 */
const identifyFace = asyncHandler(async (req, res) => {
    const image = extractImage(req);

    if (!image) {
        return res.status(400).json({
            success: false,
            error: "IMAGE_MISSING",
            message: "A JPEG or PNG image is required."
        });
    }

    const result = await faceServiceClient.identifyFace({ imageBuffer: image });

    if (!result.available) {
        return res.status(503).json({
            success: false,
            error: "FACE_UNAVAILABLE",
            decision: result.decision,
            message: result.detail || "Face service is unavailable."
        });
    }

    if (result.decision !== "MATCH" || !Number.isInteger(result.matched_student_id)) {
        return res.status(200).json({
            success: false,
            error: "FACE_NOT_IDENTIFIED",
            decision: result.decision,
            score: result.score,
            face_count: result.face_count,
            message: result.detail || "No unique enrolled student matched the image."
        });
    }

    const studentId = result.matched_student_id;
    const [students] = await db.query(
        `SELECT s.id, s.student_id AS student_code, s.name, s.status,
                fp.template_count, fp.verification_enabled
           FROM students s
           LEFT JOIN face_profiles fp ON fp.student_id = s.id
          WHERE s.id = ?
          LIMIT 1`,
        [studentId]
    );

    const student = students[0];
    const enrolled = Boolean(
        student &&
        student.status === "ACTIVE" &&
        student.verification_enabled &&
        student.template_count > 0
    );

    if (!student || !enrolled) {
        return res.status(200).json({
            success: false,
            error: student ? "STUDENT_INACTIVE" : "STUDENT_NOT_FOUND",
            decision: "IDENTITY_NOT_ELIGIBLE",
            matched_student_id: null,
            score: result.score,
            message: "The matched identity is not an active, enrolled student."
        });
    }

    return res.json({
        success: true,
        decision: "MATCH",
        matched_student_id: student.id,
        score: result.score,
        face_count: result.face_count,
        student: {
            student_db_id: student.id,
            student_id: student.student_code,
            name: student.name
        },
        message: "Face identity candidate accepted. Authorization is not performed by this endpoint."
    });
});

/**
 * Issue a single-use camera-only proof after server-side identification.
 * This endpoint identifies the student and creates evidence only; it does not
 * evaluate bus or route authorization.
 */
const issueCameraOnlyProof = asyncHandler(async (req, res) => {
    const image = extractImage(req);

    if (!image) {
        return res.status(400).json({
            success: false,
            error: "IMAGE_MISSING",
            message: "A JPEG or PNG image is required."
        });
    }

    const result = await faceServiceClient.identifyFace({ imageBuffer: image });

    if (!result.available) {
        return res.status(503).json({
            success: false,
            error: "FACE_UNAVAILABLE",
            decision: result.decision,
            message: result.detail || "Face service is unavailable."
        });
    }

    if (result.decision !== "MATCH" || !Number.isInteger(result.matched_student_id)) {
        return res.status(403).json({
            success: false,
            error: "FACE_NOT_IDENTIFIED",
            decision: result.decision,
            score: result.score,
            face_count: result.face_count,
            message: result.detail || "No unique enrolled student matched the image."
        });
    }

    const [students] = await db.query(
        `SELECT s.id, s.student_id AS student_code, s.name, s.status,
                fp.template_count, fp.verification_enabled
           FROM students s
           LEFT JOIN face_profiles fp ON fp.student_id = s.id
          WHERE s.id = ?
          LIMIT 1`,
        [result.matched_student_id]
    );

    const student = students[0];
    const enrolled = Boolean(
        student &&
        student.status === "ACTIVE" &&
        student.verification_enabled &&
        student.template_count > 0
    );

    if (!enrolled) {
        return res.status(403).json({
            success: false,
            error: student ? "STUDENT_INACTIVE" : "STUDENT_NOT_FOUND",
            decision: "IDENTITY_NOT_ELIGIBLE",
            message: "The matched identity is not an active, enrolled student."
        });
    }

    const proof = await faceTokenService.issueCameraOnlyProof({
        studentId: student.id,
        deviceId: req.device.id,
        score: result.score,
        engine: result.engine
    });

    return res.status(201).json({
        success: true,
        decision: "MATCH",
        authentication_mode: "CAMERA_ONLY",
        matched_student_id: student.id,
        score: result.score,
        face_count: result.face_count,
        student: {
            student_db_id: student.id,
            student_id: student.student_code,
            name: student.name
        },
        face_proof: proof.token,
        expires_in: require("../config/env").faceTokenTtlSeconds,
        verification_id: proof.verificationId,
        message: "Camera-only proof issued. Authorization is not performed by this endpoint."
    });
});

const checkAccess = asyncHandler(async (req, res) => {
    const rfidUid = requireString(req.body.rfid_uid, "rfid_uid", {
        min: 4, max: 64, pattern: PATTERNS.rfidUid
    });

    const routeId = requireInt(req.body.route_id, "route_id", { min: 1 });

    const faceProof = optionalString(req.body.face_proof, "face_proof", { max: 4096 });

    // A device that captured a frame but received no proof still reports the
    // verification id, so the denial is logged with its real reason instead of
    // a generic "face not performed".
    const faceVerificationId = optionalInt(req.body.face_verification_id, "face_verification_id", {
        min: 1
    });

    const clientEventId = optionalString(req.body.client_event_id, "client_event_id", {
        min: 8, max: 80, pattern: /^[A-Za-z0-9._:-]{8,80}$/
    });

    // Extra validation: an unknown bus_id in the body is rejected rather than
    // silently ignored, because it means the firmware is misconfigured.
    if (req.body.bus_id !== undefined && Number(req.body.bus_id) !== Number(req.device.bus_id)) {
        throw new ValidationError(
            `This device is registered to bus ${req.device.bus_id}, not bus ${req.body.bus_id}`
        );
    }

    const result = await accessControlService.processAccess({
        device: req.device,
        rfidUid,
        routeId,
        faceProof,
        faceVerificationId,
        clientEventId,
        gpsInput: req.body.gps,
        io: req.app.get("io")
    });

    return res.status(result.authorized ? 200 : 403).json({
        success: true,
        authorized: result.authorized,
        access_result: result.authorized ? "GRANTED" : "DENIED",
        denial_reason: result.denial_reason,
        display_reason: result.display_reason,
        message: result.message,
        boarding_record_id: result.boarding_record_id,
        boarding_type: result.boarding_type,
        authentication_mode: result.authentication_mode || "RFID",
        student: result.student || null,
        bus: result.bus || null,
        route: result.route || null,
        rfid_verified: result.rfid_verified,
        face_verified: result.face_verified,
        face_score: result.face_score,
        gps_status: result.gps_status,
        route_deviation: result.route_deviation || null,
        authorization_source: result.authorization_source || null,
        duplicate: result.duplicate || false
    });
});

const checkCameraAccess = asyncHandler(async (req, res) => {
    const routeId = requireInt(req.body.route_id, "route_id", { min: 1 });
    const faceProof = optionalString(req.body.face_proof, "face_proof", { max: 4096 });
    const faceVerificationId = optionalInt(req.body.face_verification_id, "face_verification_id", {
        min: 1
    });
    const clientEventId = optionalString(req.body.client_event_id, "client_event_id", {
        min: 8, max: 80, pattern: /^[A-Za-z0-9._:-]{8,80}$/
    });

    const result = await accessControlService.processAccess({
        device: req.device,
        routeId,
        faceProof,
        faceVerificationId,
        clientEventId,
        gpsInput: req.body.gps,
        io: req.app.get("io"),
        authenticationMode: "CAMERA_ONLY"
    });

    return res.status(result.authorized ? 200 : 403).json({
        success: true,
        authorized: result.authorized,
        access_result: result.authorized ? "GRANTED" : "DENIED",
        denial_reason: result.denial_reason,
        display_reason: result.display_reason,
        message: result.message,
        boarding_record_id: result.boarding_record_id,
        boarding_type: result.boarding_type,
        authentication_mode: result.authentication_mode || "CAMERA_ONLY",
        student: result.student || null,
        bus: result.bus || null,
        route: result.route || null,
        rfid_verified: result.rfid_verified,
        face_verified: result.face_verified,
        face_score: result.face_score,
        gps_status: result.gps_status,
        route_deviation: result.route_deviation || null,
        authorization_source: result.authorization_source || null,
        duplicate: result.duplicate || false
    });
});

/**
 * Device-facing health probe: tells the firmware which services are usable
 * before a student is standing at the door.
 */
const health = asyncHandler(async (req, res) => {
    const face = await faceServiceClient.health();

    return res.status(face.available ? 200 : 503).json({
        success: face.available,
        backend: true,
        database: true,
        face_service: face.available,
        face_engine: face.engine || null,
        enrolled_faces: face.enrolled_students ?? null,
        device: req.device,
        server_time: new Date().toISOString()
    });
});

module.exports = {
    lookupCard,
    verifyFace,
    identifyFace,
    issueCameraOnlyProof,
    checkAccess,
    checkCameraAccess,
    health,
    extractImage
};
