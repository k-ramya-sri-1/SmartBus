const db = require("../config/database");

const {
    allocateRescueStudents
} = require("../services/rescueService");


// --------------------------------------------------
// Run rescue allocation
// --------------------------------------------------

const allocateRescue = async (req, res) => {

    try {

        const {
            emergency_event_id,
            max_distance_km
        } = req.body;

        if (emergency_event_id === undefined) {
            return res.status(400).json({
                success: false,
                message: "emergency_event_id is required"
            });
        }

        const result =
            await allocateRescueStudents({
                emergencyEventId:
                    emergency_event_id,

                maxDistanceKm:
                    max_distance_km ?? 20
            });

        res.status(200).json({
            success: true,
            message:
                "Rescue allocation completed successfully",
            result
        });

    } catch (error) {

        console.error(
            "Rescue allocation error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message:
                "Failed to allocate rescue buses",
            error: error.message
        });
    }
};


// --------------------------------------------------
// Get rescue allocations for emergency
// --------------------------------------------------

const getRescueAllocations = async (req, res) => {

    try {

        const {
            emergency_id
        } = req.params;

        const [allocations] =
            await db.query(
                `SELECT
                    ra.id,
                    ra.emergency_event_id,

                    s.student_id,
                    s.name AS student_name,

                    ra.rescue_bus_id,
                    b.bus_number,
                    b.registration_number,

                    ra.allocation_status,
                    ra.allocated_at

                 FROM rescue_allocations ra

                 JOIN students s
                    ON ra.student_id = s.id

                 JOIN buses b
                    ON ra.rescue_bus_id = b.id

                 WHERE ra.emergency_event_id = ?

                 ORDER BY ra.id`,
                [emergency_id]
            );

        res.json({
            success: true,
            count: allocations.length,
            allocations
        });

    } catch (error) {

        console.error(
            "Get rescue allocations error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message:
                "Failed to fetch rescue allocations",
            error: error.message
        });
    }
};


module.exports = {
    allocateRescue,
    getRescueAllocations
};