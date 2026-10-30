/**
 * Environment loading and validation.
 *
 * Everything the backend cannot safely guess is checked once at startup so a
 * misconfigured deployment fails immediately instead of silently weakening
 * access control at runtime.
 */

const path = require("node:path");
const dotenv = require("dotenv");

const ENV_FILE = path.resolve(__dirname, "../../.env");

dotenv.config({ path: ENV_FILE, quiet: true });

function readString(name, { required = false, minLength = 0, fallback = "" } = {}) {
    const value = process.env[name];

    if (value === undefined || value === null || String(value).trim() === "") {
        if (required) {
            throw new Error(`Missing required environment variable: ${name}`);
        }
        return fallback;
    }

    const text = String(value).trim();

    if (text.length < minLength) {
        throw new Error(
            `Environment variable ${name} must be at least ${minLength} characters long.`
        );
    }

    return text;
}

function readInt(name, { required = false, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
    const raw = process.env[name];

    if (raw === undefined || String(raw).trim() === "") {
        if (required) {
            throw new Error(`Missing required environment variable: ${name}`);
        }
        return fallback;
    }

    const value = Number(raw);

    if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new Error(`Environment variable ${name} must be an integer.`);
    }

    if (value < min || value > max) {
        throw new Error(`Environment variable ${name} must be between ${min} and ${max}.`);
    }

    return value;
}

function readBoolean(name, fallback = false) {
    const raw = process.env[name];

    if (raw === undefined || String(raw).trim() === "") {
        return fallback;
    }

    return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

const config = {
    nodeEnv: readString("NODE_ENV", { fallback: "development" }),
    port: readInt("PORT", { min: 1, max: 65535, fallback: 5000 }),

    db: {
        host: readString("DB_HOST", { required: true }),
        port: readInt("DB_PORT", { required: true, min: 1, max: 65535 }),
        user: readString("DB_USER", { required: true }),
        password: readString("DB_PASSWORD"),
        name: readString("DB_NAME", { required: true })
    },

    jwtSecret: readString("JWT_SECRET", { required: true, minLength: 32 }),
    jwtExpiresIn: readString("JWT_EXPIRES_IN", { fallback: "1h" }),

    faceServiceUrl: readString("FACE_SERVICE_URL", { fallback: "http://127.0.0.1:8001" }),
    faceServiceSecret: readString("FACE_SERVICE_SECRET", { required: true, minLength: 32 }),
    faceTokenTtlSeconds: readInt("FACE_TOKEN_TTL_SECONDS", { min: 15, max: 600, fallback: 90 }),
    faceServiceTimeoutMs: readInt("FACE_SERVICE_TIMEOUT_MS", { min: 500, max: 30000, fallback: 10000 }),

    deviceOfflineGraceSeconds: readInt("DEVICE_OFFLINE_GRACE_SECONDS", { min: 0, max: 86400, fallback: 300 }),

    corsOrigins: readString("CORS_ORIGINS", { fallback: "http://localhost:5173,http://127.0.0.1:5173" })
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),

    socketAuthRequired: readBoolean("SOCKET_AUTH_REQUIRED", true)
};

/**
 * The face-verification tokens are signed with a derived key rather than the
 * session key, so a leaked token-signing path can never be replayed as a user
 * session token (and vice versa).
 */
const crypto = require("node:crypto");

config.faceTokenSecret = crypto
    .createHmac("sha256", config.jwtSecret)
    .update("smartbus:face-verification:v1")
    .digest("hex");

module.exports = config;
