/**
 * SUPERSEDED - do not mount this controller.
 *
 * The previous implementation of this endpoint accepted `face_verified` from
 * the caller, which meant any client could approve itself. Access decisions
 * now live in:
 *
 *   POST /api/authorization/check   -> controllers/accessController.checkAccess
 *   POST /api/face/verify           -> controllers/accessController.verifyFace
 *
 * The handler is kept only so an accidental re-mount fails loudly instead of
 * quietly restoring the old behaviour.
 */

function authorizeBoarding(req, res) {
    return res.status(410).json({
        success: false,
        error: "ENDPOINT_REPLACED",
        message:
            "This endpoint no longer accepts a face_verified flag. " +
            "Capture the image with POST /api/face/verify to obtain a single-use " +
            "face_token, then call POST /api/authorization/check with that token."
    });
}

module.exports = {
    authorizeBoarding
};
