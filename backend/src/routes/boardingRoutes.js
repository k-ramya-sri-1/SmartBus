const express = require("express");

const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const {
    createBoardingRecord,
    getAllBoardingRecords,
    getBoardingRecordById
} = require("../controllers/boardingController");

const router = express.Router();

router.use(authenticateToken);

// Normal traffic is written by the access-control endpoint. This route exists
// for a staff correction and therefore requires an operator role.
router.post("/", authorizeRoles("ADMIN", "TRANSPORT_MANAGER"), createBoardingRecord);

const staffRead = authorizeRoles("ADMIN", "TRANSPORT_MANAGER", "DRIVER", "CONDUCTOR");

router.get("/", staffRead, getAllBoardingRecords);
router.get("/:id", staffRead, getBoardingRecordById);

module.exports = router;
