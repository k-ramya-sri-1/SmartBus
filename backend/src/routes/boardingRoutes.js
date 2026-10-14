const express = require("express");

const {
    createBoardingRecord,
    getAllBoardingRecords,
    getBoardingRecordById
} = require("../controllers/boardingController");

const router = express.Router();

// Create boarding record
router.post("/", createBoardingRecord);

// Get all boarding records
router.get("/", getAllBoardingRecords);

// Get boarding record by ID
router.get("/:id", getBoardingRecordById);

module.exports = router;