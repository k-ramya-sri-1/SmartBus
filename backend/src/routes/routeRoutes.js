const express = require("express");

const {
    createRoute,
    getAllRoutes,
    getRouteById,
    updateRoute,
    deleteRoute
} = require("../controllers/routeController");

const {
    authenticateToken,
    authorizeRoles
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticateToken);
router.use(authorizeRoles("ADMIN", "TRANSPORT_MANAGER"));
router.post("/", createRoute);
router.get("/", getAllRoutes);
router.get("/:id", getRouteById);
router.put("/:id", updateRoute);
router.delete("/:id", deleteRoute);

module.exports = router;