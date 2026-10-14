const express = require("express");

const {
    register,
    login,
    getProfile
} = require("../controllers/authController");

const {
    authenticateToken,
    authorizeRoles
} = require("../middleware/authMiddleware");

const router = express.Router();

// Only authorized transport staff can create accounts.
router.post(
    "/register",
    authenticateToken,
    authorizeRoles("ADMIN"),
    register
);

// Login is available without a token.
router.post("/login", login);

// Retrieve the current authenticated user's profile.
router.get("/me", authenticateToken, getProfile);

module.exports = router;