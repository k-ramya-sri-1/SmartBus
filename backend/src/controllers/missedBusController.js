const {
    createMissedBusAuthorization,
    getMissedBusAuthorizations
} = require("../services/missedBusService");


// --------------------------------------------------
// POST /api/missed-bus/authorize
// --------------------------------------------------

const authorizeMissedBus = async (req, res) => {

    try {

        const {
            student_id,
            alternate_bus_id,
            valid_until,
            created_by_user_id
        } = req.body;


        if (!student_id) {

            return res.status(400).json({
                success: false,
                message: "student_id is required"
            });
        }


        if (!alternate_bus_id) {

            return res.status(400).json({
                success: false,
                message: "alternate_bus_id is required"
            });
        }


        const authorization =
            await createMissedBusAuthorization({
                studentId: student_id,
                alternateBusId: alternate_bus_id,
                validUntil: valid_until || null,
                createdByUserId:
                    created_by_user_id || null
            });


        res.status(201).json({
            success: true,
            message:
                "Missed-bus temporary authorization created successfully",
            authorization
        });


    } catch (error) {

        console.error(error);

        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};


// --------------------------------------------------
// GET /api/missed-bus/authorizations
// --------------------------------------------------

const getMissedBusAuthorizationsController =
    async (req, res) => {

        try {

            const authorizations =
                await getMissedBusAuthorizations();

            res.json({
                success: true,
                count: authorizations.length,
                authorizations
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    };


module.exports = {
    authorizeMissedBus,
    getMissedBusAuthorizationsController
};