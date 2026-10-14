const express = require("express");

const {
    registerRFID,
    getStudentByRFID
} = require("../controllers/rfidController");

const router = express.Router();

// Register RFID card
router.post("/register", registerRFID);

// Get student using RFID UID
router.get("/:uid", getStudentByRFID);

module.exports = router;