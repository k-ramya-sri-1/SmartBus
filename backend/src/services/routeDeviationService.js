/**
 * Route-deviation detection.
 *
 * A route only has geometry if an operator has entered waypoints. When it has
 * none, the honest answer is NOT_CONFIGURED, not "on route": the system must
 * never invent a location or a verdict. Deviation is recorded for every access
 * attempt that carries a fresh fix, and it only denies access when an operator
 * explicitly turns enforcement on (see `route_deviation_enforce`).
 */

const db = require("../config/database");
const { getSettings } = require("./settingsService");

const EARTH_RADIUS_M = 6371000;

function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;

    return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Perpendicular distance from a point to one segment, projected onto a local
 * tangent plane. Accurate to well under a metre at campus scale.
 */
function pointToSegmentMeters(point, start, end, referenceLat) {
    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos(toRadians(referenceLat));

    const px = (point.longitude - start.longitude) * metersPerDegLon;
    const py = (point.latitude - start.latitude) * metersPerDegLat;

    const ex = (end.longitude - start.longitude) * metersPerDegLon;
    const ey = (end.latitude - start.latitude) * metersPerDegLat;

    const lengthSquared = ex * ex + ey * ey;

    if (lengthSquared === 0) {
        return Math.hypot(px, py);
    }

    let t = (px * ex + py * ey) / lengthSquared;
    t = Math.max(0, Math.min(1, t));

    const closestX = ex * t;
    const closestY = ey * t;

    return Math.hypot(px - closestX, py - closestY);
}

async function getWaypoints(routeId) {
    const [rows] = await db.query(
        `SELECT sequence_no, latitude, longitude, label
           FROM route_waypoints
          WHERE route_id = ?
          ORDER BY sequence_no ASC`,
        [routeId]
    );

    return rows.map((row) => ({
        sequence_no: row.sequence_no,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        label: row.label
    }));
}

/**
 * Distance from a position to the route polyline.
 * Returns null when the route has fewer than two waypoints.
 */
async function distanceFromRouteMeters(routeId, latitude, longitude) {
    const waypoints = await getWaypoints(routeId);

    if (waypoints.length < 2) {
        return null;
    }

    const point = { latitude, longitude };
    let best = Infinity;

    for (let index = 0; index < waypoints.length - 1; index += 1) {
        const distance = pointToSegmentMeters(
            point,
            waypoints[index],
            waypoints[index + 1],
            latitude
        );

        if (distance < best) {
            best = distance;
        }
    }

    return best;
}

/**
 * Evaluate one position against a route.
 *
 * @returns {{status: string, distance_m: number|null, tolerance_m: number}}
 *   status: NOT_CONFIGURED | NOT_EVALUATED | ON_ROUTE | DEVIATED
 */
async function evaluateRouteDeviation({ routeId, latitude, longitude, gpsStatus }) {
    const settings = await getSettings();
    const tolerance = Number(settings.route_deviation_tolerance_m) || 1500;

    if (gpsStatus !== "GPS_FIX" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        // No trustworthy position: report that the check did not happen.
        return { status: "NOT_EVALUATED", distance_m: null, tolerance_m: tolerance };
    }

    if (!routeId) {
        return { status: "NOT_EVALUATED", distance_m: null, tolerance_m: tolerance };
    }

    const distance = await distanceFromRouteMeters(routeId, latitude, longitude);

    if (distance === null) {
        return { status: "NOT_CONFIGURED", distance_m: null, tolerance_m: tolerance };
    }

    return {
        status: distance <= tolerance ? "ON_ROUTE" : "DEVIATED",
        distance_m: Math.round(distance * 10) / 10,
        tolerance_m: tolerance
    };
}

async function isDeviationEnforced() {
    const settings = await getSettings();
    return String(settings.route_deviation_enforce).toLowerCase() === "true";
}

async function replaceWaypoints(routeId, waypoints) {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();
        await connection.query("DELETE FROM route_waypoints WHERE route_id = ?", [routeId]);

        for (let index = 0; index < waypoints.length; index += 1) {
            const waypoint = waypoints[index];
            await connection.query(
                `INSERT INTO route_waypoints (route_id, sequence_no, latitude, longitude, label)
                 VALUES (?, ?, ?, ?, ?)`,
                [routeId, index + 1, waypoint.latitude, waypoint.longitude, waypoint.label || null]
            );
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }

    return getWaypoints(routeId);
}

module.exports = {
    haversineMeters,
    pointToSegmentMeters,
    getWaypoints,
    distanceFromRouteMeters,
    evaluateRouteDeviation,
    isDeviationEnforced,
    replaceWaypoints
};
