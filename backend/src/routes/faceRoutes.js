const express = require("express");

const { authenticateDevice } = require("../middleware/deviceAuth");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const {
    verifyFace,
    identifyFace,
    issueCameraOnlyProof,
    health
} = require("../controllers/accessController");
const faceController = require("../controllers/faceController");

const router = express.Router();

// Raw JPEG upload from the OV2640. express.raw only runs for image types, so
// JSON callers (tests, tooling) still arrive as a parsed object.
const rawImage = express.raw({
    type: ["image/jpeg", "image/png"],
    limit: "4mb"
});

// --- Device endpoints -------------------------------------------------

// Verify the captured frame for the student named by the RFID card.
// Returns a single-use face token; it does not grant access by itself.
router.post("/verify", authenticateDevice(), rawImage, verifyFace);

// Phase 1 camera-only prototype: identity candidate only, never authorization.
router.post("/identify", authenticateDevice(), rawImage, identifyFace);

// Prototype-only proof issuance; authorization remains a separate operation.
router.post("/camera-proof", authenticateDevice(), rawImage, issueCameraOnlyProof);

// --- Staff endpoints --------------------------------------------------

router.get(
    "/",
    authenticateToken,
    authorizeRoles("ADMIN", "TRANSPORT_MANAGER"),
    faceController.list
);

router.post(
    "/enroll",
    authenticateToken,
    authorizeRoles("ADMIN", "TRANSPORT_MANAGER"),
    faceController.enroll
);

router.get(
    "/status/:studentId",
    authenticateToken,
    authorizeRoles("ADMIN", "TRANSPORT_MANAGER", "DRIVER", "CONDUCTOR"),
    faceController.status
);

router.delete(
    "/enroll/:studentId",
    authenticateToken,
    authorizeRoles("ADMIN", "TRANSPORT_MANAGER"),
    faceController.remove
);

module.exports = router;
