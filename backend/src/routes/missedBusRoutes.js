const express = require("express");

const {
    authorizeMissedBus,
    getMissedBusAuthorizationsController
} = require("../controllers/missedBusController");

const router = express.Router();


// Create missed-bus temporary authorization
router.post(
    "/authorize",
    authorizeMissedBus
);


// Get missed-bus authorizations
router.get(
    "/authorizations",
    getMissedBusAuthorizationsController
);


module.exports = router;