/**
 * Operating mode and route geometry administration.
 *
 * Fest Mode is switched on by an operator, with an optional window. Waypoints
 * give a route the geometry needed for deviation detection; a route without
 * waypoints reports the check as NOT_CONFIGURED instead of guessing.
 */

const db = require("../config/database");
const { asyncHandler } = require("../middleware/errors");
const settingsService = require("../services/settingsService");
const routeDeviationService = require("../services/routeDeviationService");
const {
    requireInt,
    requireEnum,
    requireBoolean,
    requireNumber,
    optionalString,
    ValidationError
} = require("../utils/validation");

function parseTimestamp(value, field) {
    if (value === undefined || value === null || value === "") {
        return "";
    }

    if (typeof value !== "string") {
        throw new ValidationError(`${field} must be an ISO timestamp string`);
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new ValidationError(`${field} is not a valid timestamp`);
    }

    return date.toISOString();
}

const getSettingsHandler = asyncHandler(async (req, res) => {
    const settings = await settingsService.getSettings();
    const mode = await settingsService.getOperatingMode();

    return res.json({
        success: true,
        operating_mode: mode,
        settings
    });
});

const setOperatingMode = asyncHandler(async (req, res) => {
    const mode = requireEnum(req.body.mode, "mode", ["NORMAL", "FEST"]);

    let startsAt = "";
    let endsAt = "";
    let enforceDeviation;

    if (req.body.starts_at !== undefined) {
        startsAt = parseTimestamp(req.body.starts_at, "starts_at");
    }

    if (req.body.ends_at !== undefined) {
        endsAt = parseTimestamp(req.body.ends_at, "ends_at");
    }

    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
        throw new ValidationError("ends_at must be after starts_at");
    }

    if (req.body.route_deviation_enforce !== undefined) {
        enforceDeviation = requireBoolean(req.body.route_deviation_enforce, "route_deviation_enforce");
    }

    const updates = {
        operating_mode: mode,
        fest_starts_at: startsAt,
        fest_ends_at: endsAt
    };

    if (enforceDeviation !== undefined) {
        updates.route_deviation_enforce = enforceDeviation ? "true" : "false";
    }

    const settings = await settingsService.setSettings(updates, req.user ? req.user.id : null);
    const described = settingsService.describeOperatingMode(settings);

    const io = req.app.get("io");

    if (io) {
        io.emit("operating_mode", described);
    }

    return res.json({
        success: true,
        message: mode === "FEST" ? "Fest Mode configured." : "Normal operation restored.",
        operating_mode: described,
        settings
    });
});

const setDeviationPolicy = asyncHandler(async (req, res) => {
    const enforce = requireBoolean(req.body.enforce, "enforce");
    const tolerance = req.body.tolerance_m === undefined
        ? undefined
        : requireNumber(req.body.tolerance_m, "tolerance_m", { min: 50, max: 20000 });

    const updates = { route_deviation_enforce: enforce ? "true" : "false" };

    if (tolerance !== undefined) {
        updates.route_deviation_tolerance_m = String(Math.round(tolerance));
    }

    const settings = await settingsService.setSettings(updates, req.user ? req.user.id : null);

    return res.json({ success: true, settings });
});

const getWaypoints = asyncHandler(async (req, res) => {
    const routeId = requireInt(req.params.id, "id", { min: 1 });
    const waypoints = await routeDeviationService.getWaypoints(routeId);

    return res.json({
        success: true,
        route_id: routeId,
        count: waypoints.length,
        deviation_detection: waypoints.length >= 2 ? "ENABLED" : "NOT_CONFIGURED",
        waypoints
    });
});

const putWaypoints = asyncHandler(async (req, res) => {
    const routeId = requireInt(req.params.id, "id", { min: 1 });

    const [routes] = await db.query("SELECT id FROM routes WHERE id = ? LIMIT 1", [routeId]);

    if (routes.length === 0) {
        return res.status(404).json({
            success: false,
            error: "ROUTE_NOT_FOUND",
            message: "Route not found."
        });
    }

    if (!Array.isArray(req.body.waypoints)) {
        throw new ValidationError("waypoints must be an array");
    }

    if (req.body.waypoints.length > 500) {
        throw new ValidationError("At most 500 waypoints are accepted");
    }

    const waypoints = req.body.waypoints.map((waypoint, index) => ({
        latitude: requireNumber(waypoint.latitude, `waypoints[${index}].latitude`, { min: -90, max: 90 }),
        longitude: requireNumber(waypoint.longitude, `waypoints[${index}].longitude`, { min: -180, max: 180 }),
        label: optionalString(waypoint.label, `waypoints[${index}].label`, { max: 120 })
    }));

    const stored = await routeDeviationService.replaceWaypoints(routeId, waypoints);

    return res.json({
        success: true,
        message: stored.length >= 2
            ? "Route geometry stored. Deviation detection is now active for this route."
            : "Route geometry stored. At least two waypoints are needed to detect deviation.",
        route_id: routeId,
        count: stored.length,
        deviation_detection: stored.length >= 2 ? "ENABLED" : "NOT_CONFIGURED",
        waypoints: stored
    });
});

module.exports = {
    getSettingsHandler,
    setOperatingMode,
    setDeviationPolicy,
    getWaypoints,
    putWaypoints
};
