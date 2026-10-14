const db = require("../config/database");

// Add a new route
const createRoute = async (req, res) => {
    try {
        const {
            route_name,
            starting_point,
            destination,
            description,
            status
        } = req.body;

        if (!route_name || !starting_point || !destination) {
            return res.status(400).json({
                success: false,
                message: "route_name, starting_point and destination are required"
            });
        }

        const [result] = await db.query(
            `INSERT INTO routes
            (route_name, starting_point, destination, description, status)
            VALUES (?, ?, ?, ?, ?)`,
            [
                route_name,
                starting_point,
                destination,
                description || null,
                status || "ACTIVE"
            ]
        );

        res.status(201).json({
            success: true,
            message: "Route created successfully",
            id: result.insertId
        });

    } catch (error) {
        console.error("Create route error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to create route",
            error: error.message
        });
    }
};


// Get all routes
const getAllRoutes = async (req, res) => {
    try {
        const [routes] = await db.query(
            "SELECT * FROM routes ORDER BY id DESC"
        );

        res.json({
            success: true,
            count: routes.length,
            routes
        });

    } catch (error) {
        console.error("Get routes error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to fetch routes",
            error: error.message
        });
    }
};


// Get route by ID
const getRouteById = async (req, res) => {
    try {
        const { id } = req.params;

        const [routes] = await db.query(
            "SELECT * FROM routes WHERE id = ?",
            [id]
        );

        if (routes.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Route not found"
            });
        }

        res.json({
            success: true,
            route: routes[0]
        });

    } catch (error) {
        console.error("Get route error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to fetch route",
            error: error.message
        });
    }
};


// Update route
const updateRoute = async (req, res) => {
    try {
        const { id } = req.params;

        const {
            route_name,
            starting_point,
            destination,
            description,
            status
        } = req.body;

        if (!route_name || !starting_point || !destination) {
            return res.status(400).json({
                success: false,
                message: "route_name, starting_point and destination are required"
            });
        }

        const [result] = await db.query(
            `UPDATE routes
             SET route_name = ?,
                 starting_point = ?,
                 destination = ?,
                 description = ?,
                 status = ?
             WHERE id = ?`,
            [
                route_name,
                starting_point,
                destination,
                description || null,
                status || "ACTIVE",
                id
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Route not found"
            });
        }

        res.json({
            success: true,
            message: "Route updated successfully"
        });

    } catch (error) {
        console.error("Update route error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to update route",
            error: error.message
        });
    }
};


// Delete route
const deleteRoute = async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.query(
            "DELETE FROM routes WHERE id = ?",
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Route not found"
            });
        }

        res.json({
            success: true,
            message: "Route deleted successfully"
        });

    } catch (error) {
        console.error("Delete route error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to delete route",
            error: error.message
        });
    }
};


module.exports = {
    createRoute,
    getAllRoutes,
    getRouteById,
    updateRoute,
    deleteRoute
};