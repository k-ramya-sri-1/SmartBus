/**
 * Face enrollment, staff-only.
 *
 * Enrollment is the only way a student becomes verifiable. It stores
 * embeddings (128 floats per sample) through the face service and records the
 * fact of enrollment here. Raw images are never written to disk and never kept
 * in the database.
 */

const db = require("../config/database");
const faceServiceClient = require("../services/faceServiceClient");
const { asyncHandler } = require("../middleware/errors");
const {
    requireInt,
    requireBoolean,
    optionalString,
    ValidationError
} = require("../utils/validation");

const MIN_ENROLL_IMAGES = 1;
const MAX_ENROLL_IMAGES = 3;

function collectImages(body) {
    const raw = [];

    if (typeof body.image === "string") {
        raw.push(body.image);
    }

    if (Array.isArray(body.images)) {
        for (const item of body.images) {
            if (typeof item === "string") {
                raw.push(item);
            }
        }
    }

    if (raw.length === 0) {
        throw new ValidationError("At least one image is required (image or images)");
    }

    if (raw.length > MAX_ENROLL_IMAGES) {
        throw new ValidationError(`At most ${MAX_ENROLL_IMAGES} images may be sent per request`);
    }

    return raw.map((item) => {
        const base64 = item.includes(",") ? item.split(",", 2)[1] : item;

        if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) {
            throw new ValidationError("image must be base64-encoded");
        }

        const buffer = Buffer.from(base64, "base64");
        const check = faceServiceClient.validateImage(buffer);

        if (!check.ok) {
            throw new ValidationError(check.message, check.code);
        }

        return buffer;
    });
}

async function findStudent(studentId) {
    const [rows] = await db.query("SELECT id, student_id, name, status FROM students WHERE id = ? LIMIT 1", [
        studentId
    ]);

    return rows[0] || null;
}

const enroll = asyncHandler(async (req, res) => {
    const studentId = requireInt(req.body.student_id, "student_id", { min: 1 });
    const replace = req.body.replace === undefined ? true : requireBoolean(req.body.replace, "replace");

    const student = await findStudent(studentId);

    if (!student) {
        return res.status(404).json({
            success: false,
            error: "STUDENT_NOT_FOUND",
            message: "Student not found."
        });
    }

    if (student.status !== "ACTIVE") {
        return res.status(409).json({
            success: false,
            error: "STUDENT_INACTIVE",
            message: "An inactive student cannot be enrolled for face verification."
        });
    }

    const images = collectImages(req.body);

    if (images.length < MIN_ENROLL_IMAGES) {
        throw new ValidationError(`At least ${MIN_ENROLL_IMAGES} image is required`);
    }

    let serviceResponse;

    try {
        serviceResponse = await faceServiceClient.enrollFace({ studentId, images });
    } catch (error) {
        return res.status(503).json({
            success: false,
            error: "FACE_SERVICE_UNAVAILABLE",
            message: "The face service is not reachable, so enrollment did not happen."
        });
    }

    const body = serviceResponse.body || {};

    if (!body.success) {
        const statusCode = body.error === "DUPLICATE_FACE" ? 409 : 422;

        return res.status(statusCode).json({
            success: false,
            error: body.error || "ENROLLMENT_FAILED",
            message: body.detail || "The face could not be enrolled.",
            conflicting_student_id: body.conflicting_student_id || null,
            rejected: body.rejected || []
        });
    }

    const templateCount = Number(body.template_count) || images.length;
    const engine = body.engine || "sface-v1";

    await db.query(
        `INSERT INTO face_profiles
            (student_id, profile_reference, engine, template_count, verification_enabled,
             enrolled_by_user_id, last_enrolled_at)
         VALUES (?, ?, ?, ?, 1, ?, NOW())
         ON DUPLICATE KEY UPDATE
            profile_reference = VALUES(profile_reference),
            engine = VALUES(engine),
            template_count = VALUES(template_count),
            verification_enabled = 1,
            enrolled_by_user_id = VALUES(enrolled_by_user_id),
            last_enrolled_at = NOW()`,
        [
            studentId,
            `face-service:${engine}:${studentId}`,
            engine,
            templateCount,
            req.user ? req.user.id : null
        ]
    );

    return res.status(201).json({
        success: true,
        message: "Face enrolled.",
        student: { id: student.id, student_id: student.student_id, name: student.name },
        template_count: templateCount,
        engine,
        rejected: body.rejected || []
    });
});

const status = asyncHandler(async (req, res) => {
    const studentId = requireInt(req.params.studentId, "studentId", { min: 1 });

    const [rows] = await db.query(
        `SELECT f.student_id, f.profile_reference, f.engine, f.template_count,
                f.verification_enabled, f.last_enrolled_at,
                s.student_id AS student_code, s.name, s.status
           FROM students s
           LEFT JOIN face_profiles f ON f.student_id = s.id
          WHERE s.id = ?
          LIMIT 1`,
        [studentId]
    );

    if (rows.length === 0) {
        return res.status(404).json({
            success: false,
            error: "STUDENT_NOT_FOUND",
            message: "Student not found."
        });
    }

    const row = rows[0];

    return res.json({
        success: true,
        student: {
            id: row.student_id,
            student_id: row.student_code,
            name: row.name,
            status: row.status
        },
        face: {
            enrolled: Boolean(row.template_count),
            verification_enabled: Boolean(row.verification_enabled),
            template_count: row.template_count || 0,
            engine: row.engine || null,
            last_enrolled_at: row.last_enrolled_at || null
        }
    });
});

const remove = asyncHandler(async (req, res) => {
    const studentId = requireInt(req.params.studentId, "studentId", { min: 1 });

    let serviceRemoved = false;

    try {
        const response = await faceServiceClient.deleteFace(studentId);
        serviceRemoved = Boolean(response.body && response.body.removed);
    } catch (error) {
        return res.status(503).json({
            success: false,
            error: "FACE_SERVICE_UNAVAILABLE",
            message: "The face service is not reachable, so enrollment was not removed."
        });
    }

    const [result] = await db.query("DELETE FROM face_profiles WHERE student_id = ?", [studentId]);

    if (!serviceRemoved && result.affectedRows === 0) {
        return res.status(404).json({
            success: false,
            error: "NOT_ENROLLED",
            message: "This student has no face enrollment."
        });
    }

    return res.json({
        success: true,
        message: "Face enrollment removed.",
        template_removed: serviceRemoved,
        profile_removed: result.affectedRows > 0
    });
});

const list = asyncHandler(async (req, res) => {
    const [rows] = await db.query(
        `SELECT f.student_id, s.student_id AS student_code, s.name, s.status,
                f.template_count, f.engine, f.verification_enabled, f.last_enrolled_at
           FROM face_profiles f
           JOIN students s ON s.id = f.student_id
          ORDER BY f.student_id ASC`
    );

    const faceService = await faceServiceClient.health();

    return res.json({
        success: true,
        count: rows.length,
        face_service_available: faceService.available,
        enrollments: rows.map((row) => ({
            student_id: row.student_id,
            student_code: row.student_code,
            name: row.name,
            status: row.status,
            template_count: row.template_count,
            engine: row.engine,
            verification_enabled: Boolean(row.verification_enabled),
            last_enrolled_at: row.last_enrolled_at
        }))
    });
});

module.exports = {
    enroll,
    status,
    remove,
    list,
    MIN_ENROLL_IMAGES,
    MAX_ENROLL_IMAGES,
    optionalString
};
