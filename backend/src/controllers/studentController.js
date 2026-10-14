const db = require("../config/database");

// Add a new student
const createStudent = async (req, res) => {
    try {
        const { student_id, name, email, phone } = req.body;

        if (!student_id || !name || !email) {
            return res.status(400).json({
                success: false,
                message: "student_id, name and email are required"
            });
        }

        const [result] = await db.query(
            `INSERT INTO students (student_id, name, email, phone)
             VALUES (?, ?, ?, ?)`,
            [student_id, name, email, phone || null]
        );

        res.status(201).json({
            success: true,
            message: "Student created successfully",
            id: result.insertId
        });

    } catch (error) {
        console.error("Create student error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to create student",
            error: error.message
        });
    }
};


// Get all students
const getAllStudents = async (req, res) => {
    try {
        const [students] = await db.query(
            "SELECT * FROM students ORDER BY id DESC"
        );

        res.json({
            success: true,
            count: students.length,
            students
        });

    } catch (error) {
        console.error("Get students error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to fetch students",
            error: error.message
        });
    }
};


// Get one student
const getStudentById = async (req, res) => {
    try {
        const { id } = req.params;

        const [students] = await db.query(
            "SELECT * FROM students WHERE id = ?",
            [id]
        );

        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Student not found"
            });
        }

        res.json({
            success: true,
            student: students[0]
        });

    } catch (error) {
        console.error("Get student error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to fetch student",
            error: error.message
        });
    }
};


// Update student
const updateStudent = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, phone, status } = req.body;

        const [result] = await db.query(
            `UPDATE students
             SET name = ?, email = ?, phone = ?, status = ?
             WHERE id = ?`,
            [
                name,
                email,
                phone || null,
                status || "ACTIVE",
                id
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Student not found"
            });
        }

        res.json({
            success: true,
            message: "Student updated successfully"
        });

    } catch (error) {
        console.error("Update student error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to update student",
            error: error.message
        });
    }
};


// Delete student
const deleteStudent = async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.query(
            "DELETE FROM students WHERE id = ?",
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Student not found"
            });
        }

        res.json({
            success: true,
            message: "Student deleted successfully"
        });

    } catch (error) {
        console.error("Delete student error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to delete student",
            error: error.message
        });
    }
};


module.exports = {
    createStudent,
    getAllStudents,
    getStudentById,
    updateStudent,
    deleteStudent
};