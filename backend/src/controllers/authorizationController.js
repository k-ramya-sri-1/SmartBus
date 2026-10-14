const {
    checkAuthorization
} = require("../services/authorizationService");

const authorizeBoarding = async (req, res) => {
    try {

        const {
            student_id,
            bus_id,
            route_id,
            rfid_card_id,
            face_verified
        } = req.body;

        // Required fields
        if (
            student_id === undefined ||
            bus_id === undefined ||
            route_id === undefined ||
            rfid_card_id === undefined ||
            face_verified === undefined
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "student_id, bus_id, route_id, rfid_card_id and face_verified are required"
            });
        }

        const result = await checkAuthorization({
            student_id,
            bus_id,
            route_id,
            rfid_card_id,
            face_verified
        });

        if (!result.authorized) {
            return res.status(403).json({
                success: true,
                authorized: false,
                access_result: "DENIED",
                denial_reason: result.reason,
                message: result.message
            });
        }

        return res.status(200).json({
            success: true,
            authorized: true,
            access_result: "GRANTED",
            denial_reason: null,
            message: result.message,
            student: result.student,
            assignment: result.assignment
        });

    } catch (error) {

        console.error(
            "Authorization error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Authorization check failed",
            error: error.message
        });
    }
};


module.exports = {
    authorizeBoarding
};