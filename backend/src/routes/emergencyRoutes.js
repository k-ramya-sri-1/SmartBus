const express = require("express");

const {
    createEmergencyEvent,
    getAllEmergencyEvents,
    getEmergencyEventById,
    updateEmergencyStatus
} = require("../controllers/emergencyController");

const router = express.Router();

// Create emergency event
router.post("/", createEmergencyEvent);

// Get all emergency events
router.get("/", getAllEmergencyEvents);

// Get emergency event by ID
router.get("/:id", getEmergencyEventById);

// Update emergency status
router.put("/:id/status", updateEmergencyStatus);

module.exports = router;