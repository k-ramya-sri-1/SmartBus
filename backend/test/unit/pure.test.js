/**
 * Unit tests for the pure parts of the access-control logic.
 *
 * These do not need a database or the face service. They pin down the
 * arithmetic and the decision helpers that the integration tests exercise only
 * indirectly, so a regression shows up as a named failing assertion rather
 * than as a mysterious denial at a bus door.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const BACKEND_DIR = path.resolve(__dirname, "..", "..");

const { describeOperatingMode } = require(path.join(BACKEND_DIR, "src", "services", "settingsService.js"));
const {
    pointToSegmentMeters,
    haversineMeters
} = require(path.join(BACKEND_DIR, "src", "services", "routeDeviationService.js"));
const { displayReason } = require(path.join(BACKEND_DIR, "src", "services", "authorizationService.js"));
const {
    validateImage,
    sniffImageType
} = require(path.join(BACKEND_DIR, "src", "services", "faceServiceClient.js"));
const {
    ValidationError,
    requireString,
    requireInt,
    requireNumber,
    requireEnum,
    requireBoolean
} = require(path.join(BACKEND_DIR, "src", "utils", "validation.js"));
const { splitStatements } = require(path.resolve(BACKEND_DIR, "..", "database", "sql-split.js"));

describe("operating mode", () => {
    const base = { operating_mode: "NORMAL", fest_starts_at: "", fest_ends_at: "" };

    it("is inactive when the mode is NORMAL", () => {
        const mode = describeOperatingMode(base);
        assert.equal(mode.mode, "NORMAL");
        assert.equal(mode.active, false);
    });

    it("is active in FEST with no window", () => {
        const mode = describeOperatingMode({ ...base, operating_mode: "FEST" });
        assert.equal(mode.active, true);
    });

    it("is inactive before the window starts", () => {
        const now = new Date("2026-10-25T08:00:00Z");
        const mode = describeOperatingMode({
            ...base,
            operating_mode: "FEST",
            fest_starts_at: "2026-10-25T10:00:00Z",
            fest_ends_at: "2026-10-25T18:00:00Z"
        }, now);

        assert.equal(mode.active, false);
        assert.match(mode.reason, /not started/);
    });

    it("is active inside the window", () => {
        const now = new Date("2026-10-25T12:00:00Z");
        const mode = describeOperatingMode({
            ...base,
            operating_mode: "FEST",
            fest_starts_at: "2026-10-25T10:00:00Z",
            fest_ends_at: "2026-10-25T18:00:00Z"
        }, now);

        assert.equal(mode.active, true);
    });

    it("is inactive after the window ends", () => {
        const now = new Date("2026-10-25T19:00:00Z");
        const mode = describeOperatingMode({
            ...base,
            operating_mode: "FEST",
            fest_starts_at: "2026-10-25T10:00:00Z",
            fest_ends_at: "2026-10-25T18:00:00Z"
        }, now);

        assert.equal(mode.active, false);
        assert.match(mode.reason, /ended/);
    });

    it("ignores an unparseable window instead of opening the mode early", () => {
        const mode = describeOperatingMode({
            ...base,
            operating_mode: "FEST",
            fest_starts_at: "not-a-date",
            fest_ends_at: "also-not-a-date"
        });

        assert.equal(mode.active, true);
        assert.equal(mode.starts_at, null);
    });
});

describe("route deviation maths", () => {
    const start = { latitude: 17.3900, longitude: 78.4800 };
    const end = { latitude: 17.3900, longitude: 78.4900 };

    it("returns zero for a point on the segment", () => {
        const distance = pointToSegmentMeters(
            { latitude: 17.3900, longitude: 78.4850 }, start, end, 17.39
        );
        assert.ok(distance < 0.5, `expected ~0, got ${distance}`);
    });

    it("measures perpendicular distance", () => {
        // 0.001 degrees of latitude is roughly 111 m.
        const distance = pointToSegmentMeters(
            { latitude: 17.3910, longitude: 78.4850 }, start, end, 17.39
        );
        assert.ok(distance > 105 && distance < 118, `got ${distance}`);
    });

    it("clamps to the nearest endpoint beyond the segment", () => {
        const distance = pointToSegmentMeters(
            { latitude: 17.3900, longitude: 78.4800 }, start, end, 17.39
        );
        assert.ok(distance < 0.5, `got ${distance}`);
    });

    it("computes a plausible haversine distance", () => {
        const distance = haversineMeters(17.3900, 78.4800, 17.4000, 78.4800);
        assert.ok(distance > 1100 && distance < 1120, `got ${distance}`);
    });
});

describe("image validation", () => {
    const jpegHeader = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2048, 1)]);
    const pngHeader = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(2048, 1)
    ]);

    it("accepts a JPEG", () => {
        assert.equal(sniffImageType(jpegHeader), "image/jpeg");
        assert.equal(validateImage(jpegHeader).ok, true);
    });

    it("accepts a PNG", () => {
        assert.equal(sniffImageType(pngHeader), "image/png");
        assert.equal(validateImage(pngHeader).ok, true);
    });

    it("rejects an empty buffer", () => {
        const result = validateImage(Buffer.alloc(0));
        assert.equal(result.ok, false);
        assert.equal(result.code, "IMAGE_MISSING");
    });

    it("rejects a buffer that is too small to hold a face", () => {
        const result = validateImage(Buffer.from([0xff, 0xd8, 0xff, 0x00]));
        assert.equal(result.ok, false);
        assert.equal(result.code, "IMAGE_TOO_SMALL");
    });

    it("rejects an unsupported format", () => {
        const result = validateImage(Buffer.from("GIF89a" + "0".repeat(2048)));
        assert.equal(result.ok, false);
        assert.equal(result.code, "IMAGE_UNSUPPORTED");
    });

    it("rejects an oversized image", () => {
        const huge = Buffer.concat([jpegHeader, Buffer.alloc(3 * 1024 * 1024, 1)]);
        const result = validateImage(huge);
        assert.equal(result.ok, false);
        assert.equal(result.code, "IMAGE_TOO_LARGE");
    });
});

describe("input validation", () => {
    it("trims and bounds strings", () => {
        assert.equal(requireString("  ABC  ", "uid"), "ABC");
        assert.throws(() => requireString("", "uid"), ValidationError);
        assert.throws(() => requireString("ab", "uid", { min: 3 }), ValidationError);
        assert.throws(() => requireString("abcd", "uid", { max: 3 }), ValidationError);
    });

    it("rejects non-integer numbers", () => {
        assert.equal(requireInt("5", "id"), 5);
        assert.throws(() => requireInt(5.5, "id"), ValidationError);
        assert.throws(() => requireInt("abc", "id"), ValidationError);
    });

    it("bounds numeric ranges", () => {
        assert.equal(requireNumber(17.4, "lat", { min: -90, max: 90 }), 17.4);
        assert.throws(() => requireNumber(91, "lat", { min: -90, max: 90 }), ValidationError);
        assert.throws(() => requireNumber(Number.NaN, "lat"), ValidationError);
    });

    it("enforces enum membership", () => {
        assert.equal(requireEnum("SOS", "event_type", ["SOS", "BREAKDOWN"]), "SOS");
        assert.throws(() => requireEnum("FIRE", "event_type", ["SOS"]), ValidationError);
    });

    it("requires real booleans", () => {
        assert.equal(requireBoolean(true, "flag"), true);
        assert.throws(() => requireBoolean("true", "flag"), ValidationError);
    });
});

describe("decision display labels", () => {
    it("maps every denial reason to a short label", () => {
        for (const reason of [
            "INVALID_RFID", "STUDENT_INACTIVE", "FACE_MISMATCH", "FACE_NOT_PERFORMED",
            "FACE_INVALID", "FACE_UNAVAILABLE", "FACE_TIMEOUT", "WRONG_BUS",
            "INVALID_ROUTE", "NO_AUTHORIZATION", "ROUTE_DEVIATION"
        ]) {
            const label = displayReason(reason);
            assert.equal(typeof label, "string");
            assert.ok(label.length > 0 && label.length <= 16, `${reason} -> ${label}`);
        }
    });

    it("falls back for an unknown reason", () => {
        assert.equal(displayReason("SOMETHING_NEW"), "DENIED");
    });
});

describe("SQL statement splitting", () => {
    it("ignores semicolons inside strings and comments", () => {
        const script = [
            "-- a comment; with a semicolon",
            "CREATE TABLE a (id INT);",
            "INSERT INTO a VALUES ('x;y');",
            "/* block; comment */",
            "UPDATE a SET id = 1;"
        ].join("\n");

        assert.equal(splitStatements(script).length, 3);
    });

    it("keeps quoted identifiers intact", () => {
        const script = "SELECT `weird;name` FROM t; SELECT 1;";
        assert.equal(splitStatements(script).length, 2);
    });
});
