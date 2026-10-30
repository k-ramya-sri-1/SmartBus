const express = require("express");

const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const deviceController = require("../controllers/deviceController");

const router = express.Router();

router.use(authenticateToken);

router.get("/", authorizeRoles("ADMIN", "TRANSPORT_MANAGER"), deviceController.list);

router.post("/", authorizeRoles("ADMIN"), deviceController.create);

router.post("/:id/rotate-key", authorizeRoles("ADMIN"), deviceController.rotateKey);

router.patch("/:id/status", authorizeRoles("ADMIN"), deviceController.updateStatus);

module.exports = router;
