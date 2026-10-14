const express = require("express");

const {
    createBus,
    getAllBuses,
    getBusById,
    updateBus,
    deleteBus
} = require("../controllers/busController");

const {
    authenticateToken,
    authorizeRoles
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticateToken);
router.use(authorizeRoles("ADMIN", "TRANSPORT_MANAGER"));

router.post("/", createBus);
router.get("/", getAllBuses);
router.get("/:id", getBusById);
router.put("/:id", updateBus);
router.delete("/:id", deleteBus);

module.exports = router;