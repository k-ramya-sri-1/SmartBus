/**
 * System settings and operating modes.
 *
 * The one mode that changes access rules is Fest Mode, defined in section 4.14
 * of the project report: during a college festival a student may use another
 * bus that serves the same route, while the permanent assignment stays
 * untouched and every alternate boarding is still recorded.
 */

const db = require("../config/database");

const DEFAULTS = {
    operating_mode: "NORMAL",
    fest_starts_at: "",
    fest_ends_at: "",
    route_deviation_enforce: "false",
    route_deviation_tolerance_m: "1500",
    gps_max_fix_age_seconds: "120"
};

async function getSettings() {
    const [rows] = await db.query("SELECT setting_key, setting_value FROM system_settings");
    const settings = { ...DEFAULTS };

    for (const row of rows) {
        settings[row.setting_key] = row.setting_value;
    }

    return settings;
}

async function getSetting(key) {
    const settings = await getSettings();
    return settings[key];
}

async function setSettings(updates, userId = null) {
    const entries = Object.entries(updates).filter(([, value]) => value !== undefined);

    for (const [key, value] of entries) {
        await db.query(
            `INSERT INTO system_settings (setting_key, setting_value, updated_by_user_id)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
                setting_value = VALUES(setting_value),
                updated_by_user_id = VALUES(updated_by_user_id)`,
            [key, String(value), userId]
        );
    }

    return getSettings();
}

/**
 * Fest Mode is active when the mode is FEST and "now" is inside the configured
 * window. An empty window means the operator switched Fest Mode on manually
 * and it stays on until it is switched off.
 */
function describeOperatingMode(settings, now = new Date()) {
    const mode = settings.operating_mode === "FEST" ? "FEST" : "NORMAL";

    const startsAt = settings.fest_starts_at ? new Date(settings.fest_starts_at) : null;
    const endsAt = settings.fest_ends_at ? new Date(settings.fest_ends_at) : null;

    const startValid = startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt : null;
    const endValid = endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null;

    let active = false;
    let reason = "Fest Mode is off";

    if (mode === "FEST") {
        if (startValid && now < startValid) {
            reason = "Fest Mode has not started yet";
        } else if (endValid && now > endValid) {
            reason = "Fest Mode has ended";
        } else {
            active = true;
            reason = "Fest Mode is active";
        }
    }

    return {
        mode,
        active,
        reason,
        starts_at: startValid ? startValid.toISOString() : null,
        ends_at: endValid ? endValid.toISOString() : null
    };
}

async function getOperatingMode(now = new Date()) {
    const settings = await getSettings();
    return describeOperatingMode(settings, now);
}

module.exports = {
    DEFAULTS,
    getSettings,
    getSetting,
    setSettings,
    describeOperatingMode,
    getOperatingMode
};
