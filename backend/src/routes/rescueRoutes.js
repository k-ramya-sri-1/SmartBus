const express = require("express");

const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const { allocateRescue, getRescueAllocations } = require("../controllers/rescueController");

const router = express.Router();

router.use(authenticateToken);
router.use(authorizeRoles("ADMIN", "TRANSPORT_MANAGER"));

router.post("/allocate", allocateRescue);
router.get("/allocations/:emergency_id", getRescueAllocations);

module.exports = router;
