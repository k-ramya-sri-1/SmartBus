/**
 * "Device or staff" authentication.
 *
 * A small number of endpoints (reporting an emergency, for example) are used
 * by the bus unit and by a staff member's browser. Both must prove who they
 * are, and the endpoint has to know which kind of caller it is dealing with.
 */

const jwt = require("jsonwebtoken");
const config = require("../config/env");
const { resolveDevice } = require("./deviceAuth");

function readBearerToken(req) {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        return null;
    }

    return header.slice("Bearer ".length).trim() || null;
}

async function authenticateDeviceOrStaff(req, res, next) {
    try {
        const token = readBearerToken(req);

        if (token) {
            try {
                req.user = jwt.verify(token, config.jwtSecret);
                req.authType = "STAFF";
                return next();
            } catch {
                // Fall through: the caller may still be a valid device.
            }
        }

        const device = await resolveDevice(req);

        if (device) {
            req.device = {
                id: device.id,
                device_uid: device.device_uid,
                bus_id: device.bus_id,
                bus_number: device.bus_number
            };
            req.authType = "DEVICE";
            return next();
        }

        return res.status(401).json({
            success: false,
            error: "UNAUTHORIZED",
            message: "Provide a valid staff token or registered device credentials."
        });
    } catch (error) {
        return next(error);
    }
}

module.exports = {
    authenticateDeviceOrStaff,
    readBearerToken
};
