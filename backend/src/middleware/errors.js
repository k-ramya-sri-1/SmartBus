/**
 * Consistent error handling.
 *
 * Every failure leaves the API in the same shape:
 *   { success: false, error: CODE, message: "..." }
 * so the firmware can branch on `error` instead of parsing prose.
 */

function asyncHandler(handler) {
    return function wrapped(req, res, next) {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

class HttpError extends Error {
    constructor(statusCode, code, message) {
        super(message);
        this.name = "HttpError";
        this.statusCode = statusCode;
        this.code = code;
    }
}

function notFoundHandler(req, res) {
    res.status(404).json({
        success: false,
        error: "NOT_FOUND",
        message: `No route for ${req.method} ${req.path}`
    });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
    const statusCode = error.statusCode || 500;
    const code = error.code || (statusCode === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");

    if (statusCode >= 500) {
        console.error("Unhandled request error:", error.message);
    }

    if (res.headersSent) {
        return next(error);
    }

    return res.status(statusCode).json({
        success: false,
        error: code,
        message: statusCode >= 500 ? "The server could not complete the request." : error.message
    });
}

module.exports = {
    asyncHandler,
    HttpError,
    notFoundHandler,
    errorHandler
};
