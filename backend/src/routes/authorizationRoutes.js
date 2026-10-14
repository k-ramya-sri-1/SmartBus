const express = require("express");

const {
    authorizeBoarding
} = require("../controllers/authorizationController");

const router = express.Router();

// Check whether a student is authorized to board
router.post("/check", authorizeBoarding);

module.exports = router;