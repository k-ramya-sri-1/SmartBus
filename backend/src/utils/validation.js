/**
 * Small, dependency-free validation helpers.
 *
 * Every value that arrives from a device, a browser or an operator passes
 * through one of these before it reaches SQL or the face service.
 */

class ValidationError extends Error {
    constructor(message, code = "INVALID_INPUT") {
        super(message);
        this.name = "ValidationError";
        this.code = code;
        this.statusCode = 400;
    }
}

function requireObject(value, field = "body") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new ValidationError(`${field} must be a JSON object`);
    }
    return value;
}

function requireString(value, field, { min = 1, max = 255, pattern = null, trim = true } = {}) {
    if (typeof value !== "string") {
        throw new ValidationError(`${field} must be a string`);
    }

    const text = trim ? value.trim() : value;

    if (text.length < min) {
        throw new ValidationError(`${field} must contain at least ${min} characters`);
    }

    if (text.length > max) {
        throw new ValidationError(`${field} must contain at most ${max} characters`);
    }

    if (pattern && !pattern.test(text)) {
        throw new ValidationError(`${field} has an invalid format`);
    }

    return text;
}

function requireInt(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;

    if (typeof number !== "number" || !Number.isFinite(number) || !Number.isInteger(number)) {
        throw new ValidationError(`${field} must be an integer`);
    }

    if (number < min || number > max) {
        throw new ValidationError(`${field} must be between ${min} and ${max}`);
    }

    return number;
}

function requireNumber(value, field, { min = -Infinity, max = Infinity } = {}) {
    const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;

    if (typeof number !== "number" || !Number.isFinite(number)) {
        throw new ValidationError(`${field} must be a finite number`);
    }

    if (number < min || number > max) {
        throw new ValidationError(`${field} must be between ${min} and ${max}`);
    }

    return number;
}

function requireBoolean(value, field) {
    if (typeof value !== "boolean") {
        throw new ValidationError(`${field} must be a boolean`);
    }
    return value;
}

function requireEnum(value, field, allowed) {
    if (!allowed.includes(value)) {
        throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}`);
    }
    return value;
}

function optionalString(value, field, options = {}) {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    return requireString(value, field, options);
}

function optionalInt(value, field, options = {}) {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    return requireInt(value, field, options);
}

const PATTERNS = {
    rfidUid: /^[A-Za-z0-9:_-]{4,64}$/,
    deviceUid: /^[A-Za-z0-9._:-]{3,64}$/,
    uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
};

module.exports = {
    ValidationError,
    PATTERNS,
    requireObject,
    requireString,
    requireInt,
    requireNumber,
    requireBoolean,
    requireEnum,
    optionalString,
    optionalInt
};
