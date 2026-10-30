const express = require("express");

const { authenticateDevice } = require("../middleware/deviceAuth");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const {
    createGPSLocation,
    getLatestGPSLocation,
    getGPSHistory
} = require("../controllers/gpsController");

const router = express.Router();

// Bus units report their own position. The bus is taken from the device
// credentials, never from the request body.
router.post("/location", authenticateDevice(), createGPSLocation);

const staffRead = [authenticateToken, authorizeRoles("ADMIN", "TRANSPORT_MANAGER", "DRIVER", "CONDUCTOR")];

router.get("/latest/:bus_id", ...staffRead, getLatestGPSLocation);
router.get("/history/:bus_id", ...staffRead, getGPSHistory);

module.exports = router;
