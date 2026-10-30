/**
 * Client for the Python face-verification service.
 *
 * The service returns which enrolled student the face matched. It never says
 * "allow"; authorization is decided in the backend. Every failure mode here
 * (timeout, connection refused, malformed response) becomes an explicit
 * negative result, never a pass.
 */

const config = require("../config/env");

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MIN_IMAGE_BYTES = 512;

function sniffImageType(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 3) {
        return null;
    }

    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "image/jpeg";
    }

    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return "image/png";
    }

    if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
        return "image/webp";
    }

    return null;
}

function validateImage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return { ok: false, code: "IMAGE_MISSING", message: "An image is required." };
    }

    if (buffer.length < MIN_IMAGE_BYTES) {
        return { ok: false, code: "IMAGE_TOO_SMALL", message: "The image is too small to contain a face." };
    }

    if (buffer.length > MAX_IMAGE_BYTES) {
        return { ok: false, code: "IMAGE_TOO_LARGE", message: "The image exceeds the 3 MB limit." };
    }

    if (!sniffImageType(buffer)) {
        return { ok: false, code: "IMAGE_UNSUPPORTED", message: "Only JPEG, PNG or WebP images are accepted." };
    }

    return { ok: true, contentType: sniffImageType(buffer) };
}

function unavailable(detail) {
    return {
        available: false,
        decision: "ENGINE_UNAVAILABLE",
        score: null,
        matched_student_id: null,
        best_other_score: null,
        face_count: 0,
        engine: null,
        detail
    };
}

async function verifyFace({ expectedStudentId, imageBuffer }) {
    const imageCheck = validateImage(imageBuffer);

    if (!imageCheck.ok) {
        return {
            available: true,
            decision: "IMAGE_INVALID",
            score: null,
            matched_student_id: null,
            best_other_score: null,
            face_count: 0,
            engine: null,
            detail: imageCheck.message
        };
    }

    try {
        const response = await fetch(`${config.faceServiceUrl}/verify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Internal-Secret": config.faceServiceSecret
            },
            body: JSON.stringify({
                expected_student_id: Number(expectedStudentId),
                image: imageBuffer.toString("base64")
            }),
            signal: AbortSignal.timeout(config.faceServiceTimeoutMs)
        });

        if (!response.ok) {
            return unavailable(`Face service responded with HTTP ${response.status}`);
        }

        const body = await response.json();

        if (!body || typeof body.decision !== "string") {
            return unavailable("Face service returned an unexpected payload");
        }

        return {
            available: true,
            decision: body.decision,
            score: typeof body.score === "number" ? body.score : null,
            matched_student_id: Number.isInteger(body.matched_student_id) ? body.matched_student_id : null,
            best_other_score: typeof body.best_other_score === "number" ? body.best_other_score : null,
            face_count: Number.isInteger(body.face_count) ? body.face_count : 0,
            engine: body.engine || null,
            threshold: typeof body.threshold === "number" ? body.threshold : null,
            detail: body.detail || ""
        };
    } catch (error) {
        const reason = error.name === "TimeoutError" || error.name === "AbortError"
            ? "Face service timed out"
            : "Face service is unreachable";
        return unavailable(reason);
    }
}

async function identifyFace({ imageBuffer }) {
    const imageCheck = validateImage(imageBuffer);

    if (!imageCheck.ok) {
        return {
            available: true,
            decision: "IMAGE_INVALID",
            score: null,
            matched_student_id: null,
            best_other_score: null,
            face_count: 0,
            engine: null,
            detail: imageCheck.message
        };
    }

    try {
        const response = await fetch(`${config.faceServiceUrl}/identify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Internal-Secret": config.faceServiceSecret
            },
            body: JSON.stringify({ image: imageBuffer.toString("base64") }),
            signal: AbortSignal.timeout(config.faceServiceTimeoutMs)
        });

        if (!response.ok) {
            return unavailable(`Face service responded with HTTP ${response.status}`);
        }

        const body = await response.json();
        const allowedDecisions = new Set([
            "MATCH",
            "NO_FACE",
            "MULTIPLE_FACES",
            "LOW_SCORE",
            "DIFFERENT_STUDENT",
            "IMAGE_INVALID"
        ]);

        if (
            !body ||
            typeof body.decision !== "string" ||
            !allowedDecisions.has(body.decision) ||
            (body.decision === "MATCH" && (
                !Number.isInteger(body.matched_student_id) ||
                body.matched_student_id <= 0 ||
                typeof body.score !== "number" ||
                !Number.isFinite(body.score) ||
                body.face_count !== 1
            ))
        ) {
            return unavailable("Face service returned an unexpected payload");
        }

        return {
            available: true,
            decision: body.decision,
            score: typeof body.score === "number" ? body.score : null,
            matched_student_id: Number.isInteger(body.matched_student_id)
                ? body.matched_student_id
                : null,
            best_other_score: typeof body.best_other_score === "number"
                ? body.best_other_score
                : null,
            face_count: Number.isInteger(body.face_count) ? body.face_count : 0,
            engine: body.engine || null,
            threshold: typeof body.threshold === "number" ? body.threshold : null,
            detail: body.detail || ""
        };
    } catch (error) {
        const reason = error.name === "TimeoutError" || error.name === "AbortError"
            ? "Face service timed out"
            : "Face service is unreachable";
        return unavailable(reason);
    }
}

async function enrollFace({ studentId, images }) {
    const response = await fetch(`${config.faceServiceUrl}/enroll`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Internal-Secret": config.faceServiceSecret
        },
        body: JSON.stringify({
            student_id: Number(studentId),
            images: images.map((image) => image.toString("base64"))
        }),
        signal: AbortSignal.timeout(config.faceServiceTimeoutMs * 2)
    });

    const body = await response.json().catch(() => null);

    return { statusCode: response.status, body };
}

async function deleteFace(studentId) {
    const response = await fetch(`${config.faceServiceUrl}/enroll/${Number(studentId)}`, {
        method: "DELETE",
        headers: { "X-Internal-Secret": config.faceServiceSecret },
        signal: AbortSignal.timeout(config.faceServiceTimeoutMs)
    });

    const body = await response.json().catch(() => null);

    return { statusCode: response.status, body };
}

async function health() {
    try {
        const response = await fetch(`${config.faceServiceUrl}/health`, {
            signal: AbortSignal.timeout(2000)
        });

        if (!response.ok) {
            return { available: false };
        }

        const body = await response.json();
        return { available: true, ...body };
    } catch {
        return { available: false };
    }
}

module.exports = {
    MAX_IMAGE_BYTES,
    validateImage,
    sniffImageType,
    verifyFace,
    identifyFace,
    enrollFace,
    deleteFace,
    health
};
