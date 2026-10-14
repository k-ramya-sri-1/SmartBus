const express = require("express");

const {
    createGPSLocation,
    getLatestGPSLocation,
    getGPSHistory
} = require("../controllers/gpsController");

const router = express.Router();

// Store GPS location
router.post("/location", createGPSLocation);

// Get latest GPS location for a bus
router.get("/latest/:bus_id", getLatestGPSLocation);

// Get complete GPS history for a bus
router.get("/history/:bus_id", getGPSHistory);

module.exports = router;