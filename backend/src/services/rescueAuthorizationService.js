const db = require("../config/database");

// --------------------------------------------------
// Create temporary rescue authorization
// --------------------------------------------------

const createRescueAuthorization = async ({
    rescueAllocationId,
    validUntil = null,
    createdByUserId = null
}) => {

    // ----------------------------------------------
    // 1. Get rescue allocation
    // ----------------------------------------------

    const [allocations] = await db.query(
        `
        SELECT
            ra.id AS rescue_allocation_id,
            ra.emergency_event_id,
            ra.student_id,
            ra.rescue_bus_id,
            ra.allocation_status,

            s.student_id AS student_code,
            s.name AS student_name,

            e.bus_id AS original_bus_id,
            original_bus.bus_number AS original_bus_number,

            rescue_bus.bus_number AS rescue_bus_number,

            ra_student_route.route_id,
            r.route_name,
            r.destination

        FROM rescue_allocations ra

        JOIN students s
            ON ra.student_id = s.id

        JOIN emergency_events e
            ON ra.emergency_event_id = e.id

        JOIN buses original_bus
            ON e.bus_id = original_bus.id

        JOIN buses rescue_bus
            ON ra.rescue_bus_id = rescue_bus.id

        LEFT JOIN bus_assignments ra_student_route
            ON ra_student_route.student_id = ra.student_id
            AND ra_student_route.bus_id = e.bus_id
            AND ra_student_route.assignment_status = 'ACTIVE'

        LEFT JOIN routes r
            ON ra_student_route.route_id = r.id

        WHERE ra.id = ?
        LIMIT 1
        `,
        [rescueAllocationId]
    );

    if (allocations.length === 0) {
        throw new Error("Rescue allocation not found");
    }

    const allocation = allocations[0];

    // ----------------------------------------------
    // 2. Allocation must be active
    // ----------------------------------------------

    if (allocation.allocation_status !== "ALLOCATED") {
        throw new Error(
            "Temporary authorization can only be created for an ALLOCATED rescue student"
        );
    }

    // ----------------------------------------------
    // 3. Prevent duplicate active authorization
    // ----------------------------------------------

    const [existing] = await db.query(
        `
        SELECT id
        FROM temporary_authorizations
        WHERE rescue_allocation_id = ?
          AND status = 'ACTIVE'
        LIMIT 1
        `,
        [rescueAllocationId]
    );

    if (existing.length > 0) {
        throw new Error(
            "An active temporary authorization already exists for this rescue allocation"
        );
    }

    // ----------------------------------------------
    // 4. Create authorization
    // ----------------------------------------------

    const [result] = await db.query(
        `
        INSERT INTO temporary_authorizations
        (
            rescue_allocation_id,
            student_id,
            temporary_bus_id,
            route_id,
            authorization_type,
            purpose,
            status,
            valid_until,
            created_by_user_id
        )
        VALUES (?, ?, ?, ?, 'EMERGENCY_RESCUE', ?, 'ACTIVE', ?, ?)
        `,
        [
            allocation.rescue_allocation_id,
            allocation.student_id,
            allocation.rescue_bus_id,
            allocation.route_id,
            "Emergency Rescue",
            validUntil,
            createdByUserId
        ]
    );

    return {
        authorization_id: result.insertId,

        rescue_allocation_id:
            allocation.rescue_allocation_id,

        emergency_event_id:
            allocation.emergency_event_id,

        student_id:
            allocation.student_id,

        student_code:
            allocation.student_code,

        student_name:
            allocation.student_name,

        original_bus_id:
            allocation.original_bus_id,

        original_bus_number:
            allocation.original_bus_number,

        temporary_bus_id:
            allocation.rescue_bus_id,

        temporary_bus_number:
            allocation.rescue_bus_number,

        route_id:
            allocation.route_id,

        route_name:
            allocation.route_name,

        destination:
            allocation.destination,

        authorization_type:
            "EMERGENCY_RESCUE",

        purpose:
            "Emergency Rescue",

        status:
            "ACTIVE",

        valid_until:
            validUntil,

        created_by_user_id:
            createdByUserId
    };
};


// --------------------------------------------------
// Get temporary authorization by ID
// --------------------------------------------------

const getAuthorizationById = async (authorizationId) => {

    const [rows] = await db.query(
        `
        SELECT
            ta.id,
            ta.rescue_allocation_id,
            ta.student_id,
            s.student_id AS student_code,
            s.name AS student_name,

            ta.temporary_bus_id,
            b.bus_number AS temporary_bus_number,

            ta.route_id,
            r.route_name,
            r.destination,

            ta.authorization_type,
            ta.purpose,
            ta.status,
            ta.valid_from,
            ta.valid_until,
            ta.created_by_user_id,
            ta.created_at

        FROM temporary_authorizations ta

        JOIN students s
            ON ta.student_id = s.id

        JOIN buses b
            ON ta.temporary_bus_id = b.id

        LEFT JOIN routes r
            ON ta.route_id = r.id

        WHERE ta.id = ?
        `,
        [authorizationId]
    );

    if (rows.length === 0) {
        throw new Error("Temporary authorization not found");
    }

    return rows[0];
};


// --------------------------------------------------
// Get all temporary authorizations
// --------------------------------------------------

const getAllAuthorizations = async () => {

    const [rows] = await db.query(
        `
        SELECT
            ta.id,
            ta.rescue_allocation_id,

            s.student_id AS student_code,
            s.name AS student_name,

            b.bus_number AS temporary_bus_number,

            r.route_name,

            ta.authorization_type,
            ta.purpose,
            ta.status,
            ta.valid_from,
            ta.valid_until,
            ta.created_at

        FROM temporary_authorizations ta

        JOIN students s
            ON ta.student_id = s.id

        JOIN buses b
            ON ta.temporary_bus_id = b.id

        LEFT JOIN routes r
            ON ta.route_id = r.id

        ORDER BY ta.id DESC
        `
    );

    return rows;
};


// --------------------------------------------------
// Update authorization status
// --------------------------------------------------

const updateAuthorizationStatus = async (
    authorizationId,
    status
) => {

    const allowedStatuses = [
        "ACTIVE",
        "USED",
        "EXPIRED",
        "CANCELLED"
    ];

    if (!allowedStatuses.includes(status)) {
        throw new Error("Invalid authorization status");
    }

    const [result] = await db.query(
        `
        UPDATE temporary_authorizations
        SET status = ?
        WHERE id = ?
        `,
        [
            status,
            authorizationId
        ]
    );

    if (result.affectedRows === 0) {
        throw new Error("Temporary authorization not found");
    }

    return await getAuthorizationById(
        authorizationId
    );
};


module.exports = {
    createRescueAuthorization,
    getAuthorizationById,
    getAllAuthorizations,
    updateAuthorizationStatus
};