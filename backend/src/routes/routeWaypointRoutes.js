const express = require("express");

const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const settingsController = require("../controllers/settingsController");

const router = express.Router();

router.use(authenticateToken);

const staffRead = authorizeRoles("ADMIN", "TRANSPORT_MANAGER", "DRIVER", "CONDUCTOR");

router.get("/:id", staffRead, settingsController.getWaypoints);

router.put(
    "/:id",
    authorizeRoles("ADMIN", "TRANSPORT_MANAGER"),
    settingsController.putWaypoints
);

module.exports = router;
