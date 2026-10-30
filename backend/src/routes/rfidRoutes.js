const express = require("express");

const { authenticateDevice } = require("../middleware/deviceAuth");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const { lookupCard } = require("../controllers/accessController");
const { registerRFID, listRFIDCards } = require("../controllers/rfidController");

const router = express.Router();

// Register an RFID card against a student (staff only).
router.post(
    "/register",
    authenticateToken,
    authorizeRoles("ADMIN", "TRANSPORT_MANAGER"),
    registerRFID
);

// Card directory for the dashboard (staff only).
router.get(
    "/",
    authenticateToken,
    authorizeRoles("ADMIN", "TRANSPORT_MANAGER", "DRIVER", "CONDUCTOR"),
    listRFIDCards
);

// Identify a card. This is the first step of the access flow, so it is
// restricted to registered bus units: the response contains the student's
// name and assignment, which must not be readable by an anonymous caller.
router.get("/:uid", authenticateDevice(), lookupCard);

module.exports = router;
