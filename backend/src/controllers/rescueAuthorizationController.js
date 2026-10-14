const {
    createRescueAuthorization,
    getAuthorizationById,
    getAllAuthorizations,
    updateAuthorizationStatus
} = require("../services/rescueAuthorizationService");


// --------------------------------------------------
// POST /api/rescue/authorize
// --------------------------------------------------

const authorizeRescueStudent = async (req, res) => {

    try {

        const {
            rescue_allocation_id,
            valid_until,
            created_by_user_id
        } = req.body;

        if (!rescue_allocation_id) {

            return res.status(400).json({
                success: false,
                message: "rescue_allocation_id is required"
            });

        }

        const authorization =
            await createRescueAuthorization({
                rescueAllocationId:
                    rescue_allocation_id,

                validUntil:
                    valid_until || null,

                createdByUserId:
                    created_by_user_id || null
            });

        res.status(201).json({
            success: true,
            message:
                "Temporary rescue authorization created successfully",
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
// GET /api/rescue/authorizations
// --------------------------------------------------

const getAuthorizations = async (req, res) => {

    try {

        const authorizations =
            await getAllAuthorizations();

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


// --------------------------------------------------
// GET /api/rescue/authorizations/:id
// --------------------------------------------------

const getAuthorization = async (req, res) => {

    try {

        const authorization =
            await getAuthorizationById(
                req.params.id
            );

        res.json({
            success: true,
            authorization
        });

    } catch (error) {

        console.error(error);

        res.status(404).json({
            success: false,
            message: error.message
        });
    }
};


// --------------------------------------------------
// PUT /api/rescue/authorizations/:id/status
// --------------------------------------------------

const changeAuthorizationStatus = async (
    req,
    res
) => {

    try {

        const {
            status
        } = req.body;

        if (!status) {

            return res.status(400).json({
                success: false,
                message: "status is required"
            });

        }

        const authorization =
            await updateAuthorizationStatus(
                req.params.id,
                status
            );

        res.json({
            success: true,
            message:
                "Authorization status updated successfully",
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


module.exports = {
    authorizeRescueStudent,
    getAuthorizations,
    getAuthorization,
    changeAuthorizationStatus
};