const express = require("express");

const {
    createStudent,
    getAllStudents,
    getStudentById,
    updateStudent,
    deleteStudent
} = require("../controllers/studentController");

const {
    authenticateToken,
    authorizeRoles
} = require("../middleware/authMiddleware");

const router = express.Router();

// All student-management operations require authorized staff.
router.use(authenticateToken);
router.use(authorizeRoles("ADMIN", "TRANSPORT_MANAGER"));

router.post("/", createStudent);
router.get("/", getAllStudents);
router.get("/:id", getStudentById);
router.put("/:id", updateStudent);
router.delete("/:id", deleteStudent);

module.exports = router;