const db = require("../config/database");

// Add a new bus
const createBus = async (req, res) => {
    try {
        const {
            bus_number,
            registration_number,
            maximum_capacity,
            status
        } = req.body;

        if (!bus_number || !registration_number || !maximum_capacity) {
            return res.status(400).json({
                success: false,
                message: "bus_number, registration_number and maximum_capacity are required"
            });
        }

        if (maximum_capacity <= 0) {
            return res.status(400).json({
                success: false,
                message: "maximum_capacity must be greater than 0"
            });
        }

        const [result] = await db.query(
            `INSERT INTO buses
            (bus_number, registration_number, maximum_capacity, status)
            VALUES (?, ?, ?, ?)`,
            [
                bus_number,
                registration_number,
                maximum_capacity,
                status || "ACTIVE"
            ]
        );

        res.status(201).json({
            success: true,
            message: "Bus created successfully",
            id: result.insertId
        });

    } catch (error) {
        console.error("Create bus error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to create bus",
            error: error.message
        });
    }
};


// Get all buses
const getAllBuses = async (req, res) => {
    try {
        const [buses] = await db.query(
            "SELECT * FROM buses ORDER BY id DESC"
        );

        res.json({
            success: true,
            count: buses.length,
            buses
        });

    } catch (error) {
        console.error("Get buses error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to fetch buses",
            error: error.message
        });
    }
};


// Get bus by ID
const getBusById = async (req, res) => {
    try {
        const { id } = req.params;

        const [buses] = await db.query(
            "SELECT * FROM buses WHERE id = ?",
            [id]
        );

        if (buses.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Bus not found"
            });
        }

        res.json({
            success: true,
            bus: buses[0]
        });

    } catch (error) {
        console.error("Get bus error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to fetch bus",
            error: error.message
        });
    }
};


// Update bus
const updateBus = async (req, res) => {
    try {
        const { id } = req.params;

        const {
            bus_number,
            registration_number,
            maximum_capacity,
            status
        } = req.body;

        if (!bus_number || !registration_number || !maximum_capacity) {
            return res.status(400).json({
                success: false,
                message: "bus_number, registration_number and maximum_capacity are required"
            });
        }

        if (maximum_capacity <= 0) {
            return res.status(400).json({
                success: false,
                message: "maximum_capacity must be greater than 0"
            });
        }

        const [result] = await db.query(
            `UPDATE buses
             SET bus_number = ?,
                 registration_number = ?,
                 maximum_capacity = ?,
                 status = ?
             WHERE id = ?`,
            [
                bus_number,
                registration_number,
                maximum_capacity,
                status || "ACTIVE",
                id
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Bus not found"
            });
        }

        res.json({
            success: true,
            message: "Bus updated successfully"
        });

    } catch (error) {
        console.error("Update bus error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to update bus",
            error: error.message
        });
    }
};


// Delete bus
const deleteBus = async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.query(
            "DELETE FROM buses WHERE id = ?",
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Bus not found"
            });
        }

        res.json({
            success: true,
            message: "Bus deleted successfully"
        });

    } catch (error) {
        console.error("Delete bus error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to delete bus",
            error: error.message
        });
    }
};


module.exports = {
    createBus,
    getAllBuses,
    getBusById,
    updateBus,
    deleteBus
};