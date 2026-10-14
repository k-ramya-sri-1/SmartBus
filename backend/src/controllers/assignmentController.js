const db = require("../config/database");

// Create a bus assignment
const createAssignment = async (req, res) => {
    try {
        const {
            student_id,
            bus_id,
            route_id,
            assignment_status,
            valid_from,
            valid_to
        } = req.body;

        if (!student_id || !bus_id || !route_id) {
            return res.status(400).json({
                success: false,
                message: "student_id, bus_id and route_id are required"
            });
        }

        // Check student
        const [students] = await db.query(
            "SELECT id, student_id, name FROM students WHERE id = ?",
            [student_id]
        );

        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Student not found"
            });
        }

        // Check bus
        const [buses] = await db.query(
            "SELECT id, bus_number FROM buses WHERE id = ?",
            [bus_id]
        );

        if (buses.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Bus not found"
            });
        }

        // Check route
        const [routes] = await db.query(
            "SELECT id, route_name FROM routes WHERE id = ?",
            [route_id]
        );

        if (routes.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Route not found"
            });
        }

        const [result] = await db.query(
            `INSERT INTO bus_assignments
            (student_id, bus_id, route_id, assignment_status, valid_from, valid_to)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                student_id,
                bus_id,
                route_id,
                assignment_status || "ACTIVE",
                valid_from || null,
                valid_to || null
            ]
        );

        res.status(201).json({
            success: true,
            message: "Bus assignment created successfully",
            id: result.insertId
        });

    } catch (error) {
        console.error("Create assignment error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to create bus assignment",
            error: error.message
        });
    }
};


// Get all assignments
const getAllAssignments = async (req, res) => {
    try {
        const [assignments] = await db.query(`
            SELECT
                ba.id,
                ba.assignment_status,
                ba.valid_from,
                ba.valid_to,
                s.student_id,
                s.name AS student_name,
                b.bus_number,
                b.registration_number,
                r.route_name,
                r.starting_point,
                r.destination
            FROM bus_assignments ba
            JOIN students s ON ba.student_id = s.id
            JOIN buses b ON ba.bus_id = b.id
            JOIN routes r ON ba.route_id = r.id
            ORDER BY ba.id DESC
        `);

        res.json({
            success: true,
            count: assignments.length,
            assignments
        });

    } catch (error) {
        console.error("Get assignments error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to fetch assignments",
            error: error.message
        });
    }
};


// Get assignment by ID
const getAssignmentById = async (req, res) => {
    try {
        const { id } = req.params;

        const [assignments] = await db.query(`
            SELECT
                ba.id,
                ba.student_id,
                ba.bus_id,
                ba.route_id,
                ba.assignment_status,
                ba.valid_from,
                ba.valid_to,
                s.student_id AS student_code,
                s.name AS student_name,
                b.bus_number,
                b.registration_number,
                r.route_name,
                r.starting_point,
                r.destination
            FROM bus_assignments ba
            JOIN students s ON ba.student_id = s.id
            JOIN buses b ON ba.bus_id = b.id
            JOIN routes r ON ba.route_id = r.id
            WHERE ba.id = ?
        `, [id]);

        if (assignments.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Bus assignment not found"
            });
        }

        res.json({
            success: true,
            assignment: assignments[0]
        });

    } catch (error) {
        console.error("Get assignment error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to fetch assignment",
            error: error.message
        });
    }
};


// Update assignment
const updateAssignment = async (req, res) => {
    try {
        const { id } = req.params;

        const {
            student_id,
            bus_id,
            route_id,
            assignment_status,
            valid_from,
            valid_to
        } = req.body;

        if (!student_id || !bus_id || !route_id) {
            return res.status(400).json({
                success: false,
                message: "student_id, bus_id and route_id are required"
            });
        }

        const [result] = await db.query(
            `UPDATE bus_assignments
             SET student_id = ?,
                 bus_id = ?,
                 route_id = ?,
                 assignment_status = ?,
                 valid_from = ?,
                 valid_to = ?
             WHERE id = ?`,
            [
                student_id,
                bus_id,
                route_id,
                assignment_status || "ACTIVE",
                valid_from || null,
                valid_to || null,
                id
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Bus assignment not found"
            });
        }

        res.json({
            success: true,
            message: "Bus assignment updated successfully"
        });

    } catch (error) {
        console.error("Update assignment error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to update bus assignment",
            error: error.message
        });
    }
};


// Delete assignment
const deleteAssignment = async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.query(
            "DELETE FROM bus_assignments WHERE id = ?",
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Bus assignment not found"
            });
        }

        res.json({
            success: true,
            message: "Bus assignment deleted successfully"
        });

    } catch (error) {
        console.error("Delete assignment error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to delete bus assignment",
            error: error.message
        });
    }
};


module.exports = {
    createAssignment,
    getAllAssignments,
    getAssignmentById,
    updateAssignment,
    deleteAssignment
};