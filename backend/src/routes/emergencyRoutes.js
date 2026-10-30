const express = require("express");

const { authenticateDeviceOrStaff } = require("../middleware/anyAuth");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const {
    createEmergencyEvent,
    getAllEmergencyEvents,
    getEmergencyEventById,
    updateEmergencyStatus
} = require("../controllers/emergencyController");

const router = express.Router();

// An SOS comes from the bus unit (device credentials) or from a staff member
// who is reporting on the bus unit's behalf (bearer token).
router.post("/", authenticateDeviceOrStaff, createEmergencyEvent);

const staffRead = [authenticateToken, authorizeRoles("ADMIN", "TRANSPORT_MANAGER", "DRIVER", "CONDUCTOR")];

router.get("/", ...staffRead, getAllEmergencyEvents);
router.get("/:id", ...staffRead, getEmergencyEventById);

router.put(
    "/:id/status",
    authenticateToken,
    authorizeRoles("ADMIN", "TRANSPORT_MANAGER"),
    updateEmergencyStatus
);

module.exports = router;
