const db = require("../config/database");

// Create emergency event
const createEmergencyEvent = async (req, res) => {
    try {
        const {
            bus_id,
            reported_by_user_id,
            event_type,
            description,
            latitude,
            longitude
        } = req.body;

        // ---------------------------------------------
        // 1. Required fields
        // ---------------------------------------------

        if (
            bus_id === undefined ||
            event_type === undefined ||
            latitude === undefined ||
            longitude === undefined
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "bus_id, event_type, latitude and longitude are required"
            });
        }

        // ---------------------------------------------
        // 2. Validate emergency type
        // ---------------------------------------------

        const allowedEventTypes = [
            "SOS",
            "BREAKDOWN",
            "ACCIDENT",
            "OTHER"
        ];

        if (!allowedEventTypes.includes(event_type)) {
            return res.status(400).json({
                success: false,
                message:
                    "event_type must be SOS, BREAKDOWN, ACCIDENT or OTHER"
            });
        }

        // ---------------------------------------------
        // 3. Validate latitude
        // ---------------------------------------------

        if (
            typeof latitude !== "number" ||
            latitude < -90 ||
            latitude > 90
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Latitude must be a number between -90 and 90"
            });
        }

        // ---------------------------------------------
        // 4. Validate longitude
        // ---------------------------------------------

        if (
            typeof longitude !== "number" ||
            longitude < -180 ||
            longitude > 180
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Longitude must be a number between -180 and 180"
            });
        }

        // ---------------------------------------------
        // 5. Check bus
        // ---------------------------------------------

        const [buses] = await db.query(
            `SELECT
                id,
                bus_number,
                registration_number,
                maximum_capacity,
                status
             FROM buses
             WHERE id = ?`,
            [bus_id]
        );

        if (buses.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Bus not found"
            });
        }

        const bus = buses[0];

        // ---------------------------------------------
        // 6. If user ID is provided, verify user
        // ---------------------------------------------

        if (reported_by_user_id !== undefined &&
            reported_by_user_id !== null) {

            const [users] = await db.query(
                `SELECT
                    id,
                    username,
                    role,
                    status
                 FROM users
                 WHERE id = ?`,
                [reported_by_user_id]
            );

            if (users.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Reporting user not found"
                });
            }
        }

        // ---------------------------------------------
        // 7. Create emergency event
        // ---------------------------------------------

        const [result] = await db.query(
            `INSERT INTO emergency_events
            (
                bus_id,
                reported_by_user_id,
                event_type,
                description,
                latitude,
                longitude,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, 'OPEN')`,
            [
                bus_id,
                reported_by_user_id ?? null,
                event_type,
                description ?? null,
                latitude,
                longitude
            ]
        );

        // ---------------------------------------------
        // 8. Response
        // ---------------------------------------------

        res.status(201).json({
            success: true,
            message: "Emergency event created successfully",

            emergency: {
                id: result.insertId,
                bus_id: bus.id,
                bus_number: bus.bus_number,
                event_type,
                description: description ?? null,
                latitude,
                longitude,
                status: "OPEN"
            }
        });

    } catch (error) {

        console.error(
            "Create emergency event error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Failed to create emergency event",
            error: error.message
        });
    }
};


// Get all emergency events
const getAllEmergencyEvents = async (req, res) => {
    try {

        const [events] = await db.query(
            `SELECT
                e.id,
                e.bus_id,
                b.bus_number,
                b.registration_number,
                e.reported_by_user_id,
                u.username AS reported_by,
                u.role AS reporter_role,
                e.event_type,
                e.description,
                e.latitude,
                e.longitude,
                e.status,
                e.created_at
             FROM emergency_events e
             JOIN buses b
                ON e.bus_id = b.id
             LEFT JOIN users u
                ON e.reported_by_user_id = u.id
             ORDER BY e.id DESC`
        );

        res.json({
            success: true,
            count: events.length,
            events
        });

    } catch (error) {

        console.error(
            "Get emergency events error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Failed to fetch emergency events",
            error: error.message
        });
    }
};


// Get emergency event by ID
const getEmergencyEventById = async (req, res) => {
    try {

        const { id } = req.params;

        const [events] = await db.query(
            `SELECT
                e.id,
                e.bus_id,
                b.bus_number,
                b.registration_number,
                e.reported_by_user_id,
                u.username AS reported_by,
                u.role AS reporter_role,
                e.event_type,
                e.description,
                e.latitude,
                e.longitude,
                e.status,
                e.created_at
             FROM emergency_events e
             JOIN buses b
                ON e.bus_id = b.id
             LEFT JOIN users u
                ON e.reported_by_user_id = u.id
             WHERE e.id = ?`,
            [id]
        );

        if (events.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Emergency event not found"
            });
        }

        res.json({
            success: true,
            emergency: events[0]
        });

    } catch (error) {

        console.error(
            "Get emergency event error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Failed to fetch emergency event",
            error: error.message
        });
    }
};


// Update emergency status
const updateEmergencyStatus = async (req, res) => {
    try {

        const { id } = req.params;
        const { status } = req.body;

        const allowedStatuses = [
            "OPEN",
            "IN_PROGRESS",
            "RESOLVED",
            "CANCELLED"
        ];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message:
                    "status must be OPEN, IN_PROGRESS, RESOLVED or CANCELLED"
            });
        }

        const [result] = await db.query(
            `UPDATE emergency_events
             SET status = ?
             WHERE id = ?`,
            [status, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Emergency event not found"
            });
        }

        res.json({
            success: true,
            message: "Emergency status updated successfully",
            id,
            status
        });

    } catch (error) {

        console.error(
            "Update emergency status error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Failed to update emergency status",
            error: error.message
        });
    }
};


module.exports = {
    createEmergencyEvent,
    getAllEmergencyEvents,
    getEmergencyEventById,
    updateEmergencyStatus
};