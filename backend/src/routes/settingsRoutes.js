const express = require("express");

const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const settingsController = require("../controllers/settingsController");

const router = express.Router();

router.use(authenticateToken);

// Read: any signed-in staff member.
router.get(
    "/",
    authorizeRoles("ADMIN", "TRANSPORT_MANAGER", "DRIVER", "CONDUCTOR"),
    settingsController.getSettingsHandler
);

// Change the operating mode (NORMAL / FEST): administrator only.
router.put("/operating-mode", authorizeRoles("ADMIN"), settingsController.setOperatingMode);

// Change the route-deviation policy: administrator only.
router.put("/route-deviation", authorizeRoles("ADMIN"), settingsController.setDeviationPolicy);

module.exports = router;
