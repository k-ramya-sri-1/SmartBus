/**
 * Single-use face-verification tokens.
 *
 * This is the mechanism that makes "the face was verified" a fact the backend
 * observed rather than a boolean the device asserts:
 *
 *   1. the backend asks the face service about a captured image,
 *   2. it stores the outcome in face_verifications under a fresh token id,
 *   3. only a MATCH produces a signed token,
 *   4. the access endpoint consumes the token exactly once,
 *   5. the token is bound to one student, one device and its authentication
 *      mode; RFID tokens also bind to one RFID card.
 *
 * A device that replays an old token, reuses a consumed token, forwards
 * somebody else's token, or simply posts `face_verified: true` gets nothing.
 */

const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const db = require("../config/database");
const config = require("../config/env");
const faceServiceClient = require("./faceServiceClient");

const ISSUER = "smartbus-face";
const AUDIENCE = "smartbus-access";

function expiryDate(ttlSeconds) {
    return new Date(Date.now() + ttlSeconds * 1000);
}

/**
 * Ask the face service, persist the evidence, and return a token when (and
 * only when) the captured face matched the expected student.
 */
async function verifyAndIssue({
    studentId,
    rfidCardId,
    deviceId,
    expectedProfileExists,
    imageBuffer
}) {
    const ttl = config.faceTokenTtlSeconds;
    const tokenId = crypto.randomUUID();

    if (!expectedProfileExists) {
        const row = {
            token_id: tokenId,
            student_id: studentId,
            rfid_card_id: rfidCardId,
            device_id: deviceId,
            matched_student_id: null,
            score: null,
            decision: "NOT_ENROLLED",
            engine: null,
            expires_at: new Date()
        };

        await insertVerification(row);

        return {
            success: false,
            decision: "NOT_ENROLLED",
            score: null,
            matched_student_id: null,
            token: null,
            verification_id: null,
            detail: "No enrolled face template exists for this student"
        };
    }

    const result = await faceServiceClient.verifyFace({
        expectedStudentId: studentId,
        imageBuffer
    });

    // The face service must explicitly confirm the same student. A match to a
    // different student is recorded and refused.
    const identityConfirmed =
        result.available === true &&
        result.decision === "MATCH" &&
        result.matched_student_id === Number(studentId);

    const decision = result.available === false
        ? "ENGINE_UNAVAILABLE"
        : identityConfirmed
            ? "MATCH"
            : result.decision;

    const expiresAt = expiryDate(ttl);

    const verification = {
        token_id: tokenId,
        student_id: studentId,
        rfid_card_id: rfidCardId,
        device_id: deviceId,
        authentication_mode: "RFID",
        matched_student_id: result.matched_student_id,
        score: result.score,
        decision,
        engine: result.engine,
        expires_at: expiresAt
    };

    const verificationId = await insertVerification(verification);

    if (!identityConfirmed) {
        return {
            success: false,
            decision,
            score: result.score,
            matched_student_id: result.matched_student_id,
            token: null,
            verification_id: verificationId,
            detail: result.detail
        };
    }

    const token = jwt.sign(
        {
            jti: tokenId,
            sub: String(studentId),
            mode: "RFID",
            card: Number(rfidCardId),
            dev: Number(deviceId),
            dec: "MATCH",
            score: result.score
        },
        config.faceTokenSecret,
        {
            expiresIn: ttl,
            issuer: ISSUER,
            audience: AUDIENCE
        }
    );

    return {
        success: true,
        decision: "MATCH",
        score: result.score,
        matched_student_id: result.matched_student_id,
        token,
        token_id: tokenId,
        expires_at: expiresAt.toISOString(),
        verification_id: verificationId,
        detail: result.detail
    };
}

async function issueCameraOnlyProof({ studentId, deviceId, score, engine }) {
    const tokenId = crypto.randomUUID();
    const expiresAt = expiryDate(config.faceTokenTtlSeconds);

    const verificationId = await insertVerification({
        token_id: tokenId,
        student_id: studentId,
        rfid_card_id: null,
        device_id: deviceId,
        authentication_mode: "CAMERA_ONLY",
        matched_student_id: studentId,
        score,
        decision: "MATCH",
        engine,
        expires_at: expiresAt
    });

    const token = jwt.sign(
        {
            jti: tokenId,
            sub: String(studentId),
            mode: "CAMERA_ONLY",
            dev: Number(deviceId),
            dec: "MATCH",
            score
        },
        config.faceTokenSecret,
        {
            expiresIn: config.faceTokenTtlSeconds,
            issuer: ISSUER,
            audience: AUDIENCE
        }
    );

    return {
        token,
        tokenId,
        verificationId,
        expiresAt: expiresAt.toISOString()
    };
}

async function insertVerification(row) {
    const [result] = await db.query(
        `INSERT INTO face_verifications
            (token_id, student_id, rfid_card_id, device_id, authentication_mode,
             matched_student_id, score, decision, engine, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            row.token_id,
            row.student_id,
            row.rfid_card_id,
            row.device_id,
            row.authentication_mode || "RFID",
            row.matched_student_id,
            row.score,
            row.decision,
            row.engine,
            row.expires_at
        ]
    );

    return result.insertId;
}

/**
 * Validate the token's signature and lifetime. Throws on failure; the caller
 * turns that into a denial reason.
 */
function verifyToken(token) {
    try {
        return jwt.verify(token, config.faceTokenSecret, {
            issuer: ISSUER,
            audience: AUDIENCE,
            algorithms: ["HS256"]
        });
    } catch (error) {
        const expired = error.name === "TokenExpiredError";
        const wrapped = new Error(expired
            ? "The face verification has expired. Scan the card again."
            : "The face verification token is not valid.");
        wrapped.code = expired ? "FACE_TOKEN_EXPIRED" : "FACE_TOKEN_INVALID";
        wrapped.statusCode = 403;
        throw wrapped;
    }
}

/**
 * Atomically mark a token as used. Returns false when another request already
 * consumed it or it is past its expiry, which makes double-scan replay
 * impossible even with concurrent requests.
 */
async function consumeToken(tokenId, executor = db) {
    const [result] = await executor.query(
        `UPDATE face_verifications
            SET used_at = NOW()
          WHERE token_id = ?
            AND used_at IS NULL
            AND expires_at > NOW()`,
        [tokenId]
    );

    return result.affectedRows === 1;
}

async function getVerificationByTokenId(tokenId) {
    const [rows] = await db.query(
        `SELECT id, token_id, student_id, rfid_card_id, device_id, authentication_mode,
                matched_student_id, score, decision, engine, expires_at, used_at, created_at
           FROM face_verifications
          WHERE token_id = ?
          LIMIT 1`,
        [tokenId]
    );

    return rows[0] || null;
}

async function getVerificationById(verificationId) {
    const [rows] = await db.query(
        `SELECT id, token_id, student_id, rfid_card_id, device_id, authentication_mode,
                matched_student_id, score, decision, engine, expires_at, used_at, created_at
           FROM face_verifications
          WHERE id = ?
          LIMIT 1`,
        [verificationId]
    );

    return rows[0] || null;
}

async function validateCameraOnlyProof({ token, deviceId, studentId }) {
    const claims = verifyToken(token);

    if (claims.mode !== "CAMERA_ONLY" || Number(claims.dev) !== Number(deviceId)) {
        const error = new Error("The camera-only proof is not valid for this device.");
        error.code = "FACE_TOKEN_INVALID";
        throw error;
    }

    if (studentId !== undefined && Number(claims.sub) !== Number(studentId)) {
        const error = new Error("The camera-only proof belongs to a different student.");
        error.code = "FACE_TOKEN_INVALID";
        throw error;
    }

    const verification = await getVerificationByTokenId(claims.jti);

    if (
        !verification ||
        verification.authentication_mode !== "CAMERA_ONLY" ||
        Number(verification.device_id) !== Number(deviceId) ||
        verification.decision !== "MATCH" ||
        (studentId !== undefined && Number(verification.student_id) !== Number(studentId))
    ) {
        const error = new Error("The camera-only proof is not valid.");
        error.code = "FACE_TOKEN_INVALID";
        throw error;
    }

    if (verification.used_at) {
        const error = new Error("This camera-only proof has already been used or has expired.");
        error.code = "FACE_TOKEN_REUSED";
        throw error;
    }

    return { claims, verification };
}

async function consumeCameraOnlyProof({ token, deviceId, studentId, executor = db }) {
    const { claims, verification } = await validateCameraOnlyProof({ token, deviceId, studentId });

    if (!(await consumeToken(claims.jti, executor))) {
        const error = new Error("This camera-only proof has already been used or has expired.");
        error.code = "FACE_TOKEN_REUSED";
        throw error;
    }

    return { claims, verification };
}

module.exports = {
    verifyAndIssue,
    issueCameraOnlyProof,
    verifyToken,
    consumeToken,
    validateCameraOnlyProof,
    consumeCameraOnlyProof,
    getVerificationByTokenId,
    getVerificationById,
    ISSUER,
    AUDIENCE
};
