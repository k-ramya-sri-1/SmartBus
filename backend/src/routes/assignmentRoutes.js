const express = require("express");

const {
    createAssignment,
    getAllAssignments,
    getAssignmentById,
    updateAssignment,
    deleteAssignment
} = require("../controllers/assignmentController");

const {
    authenticateToken,
    authorizeRoles
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticateToken);
router.use(authorizeRoles("ADMIN", "TRANSPORT_MANAGER"));

router.post("/", createAssignment);
router.get("/", getAllAssignments);
router.get("/:id", getAssignmentById);
router.put("/:id", updateAssignment);
router.delete("/:id", deleteAssignment);

module.exports = router;