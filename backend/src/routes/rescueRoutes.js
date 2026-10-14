const express = require("express");

const {
    allocateRescue,
    getRescueAllocations
} = require("../controllers/rescueController");

const router = express.Router();

// Run rescue allocation algorithm
router.post("/allocate", allocateRescue);

// Get allocations for emergency
router.get("/allocations/:emergency_id", getRescueAllocations);

module.exports = router;