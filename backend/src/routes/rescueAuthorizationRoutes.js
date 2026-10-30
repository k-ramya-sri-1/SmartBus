const express = require("express");

const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const {
    authorizeRescueStudent,
    getAuthorizations,
    getAuthorization,
    changeAuthorizationStatus
} = require("../controllers/rescueAuthorizationController");

const router = express.Router();

router.use(authenticateToken);
router.use(authorizeRoles("ADMIN", "TRANSPORT_MANAGER"));

router.post("/authorize", authorizeRescueStudent);
router.get("/authorizations", getAuthorizations);
router.get("/authorizations/:id", getAuthorization);
router.put("/authorizations/:id/status", changeAuthorizationStatus);

module.exports = router;
