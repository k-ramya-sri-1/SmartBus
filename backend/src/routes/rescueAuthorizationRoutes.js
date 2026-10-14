const express = require("express");

const {
    authorizeRescueStudent,
    getAuthorizations,
    getAuthorization,
    changeAuthorizationStatus
} = require("../controllers/rescueAuthorizationController");

const router = express.Router();


// Create temporary rescue authorization
router.post(
    "/authorize",
    authorizeRescueStudent
);


// Get all authorizations
router.get(
    "/authorizations",
    getAuthorizations
);


// Get authorization by ID
router.get(
    "/authorizations/:id",
    getAuthorization
);


// Update authorization status
router.put(
    "/authorizations/:id/status",
    changeAuthorizationStatus
);


module.exports = router;