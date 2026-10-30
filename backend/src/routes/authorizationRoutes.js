const express = require("express");

const { authenticateDevice } = require("../middleware/deviceAuth");
const { checkAccess, checkCameraAccess, health } = require("../controllers/accessController");

const router = express.Router();

// The single access decision endpoint. It replaces the previous contract that
// accepted a `face_verified` boolean from the caller: a decision can only be
// granted against a face token the backend itself issued and has not yet seen
// used.
router.post("/check", authenticateDevice(), checkAccess);
router.post("/camera-check", authenticateDevice(), checkCameraAccess);

// Device-facing readiness probe: database, face service and its own identity.
router.get("/health", authenticateDevice(), health);

module.exports = router;
