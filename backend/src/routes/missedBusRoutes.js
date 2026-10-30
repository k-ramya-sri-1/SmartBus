const express = require("express");

const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const {
    authorizeMissedBus,
    getMissedBusAuthorizationsController
} = require("../controllers/missedBusController");

const router = express.Router();

router.use(authenticateToken);
router.use(authorizeRoles("ADMIN", "TRANSPORT_MANAGER"));

router.post("/authorize", authorizeMissedBus);
router.get("/authorizations", getMissedBusAuthorizationsController);

module.exports = router;
