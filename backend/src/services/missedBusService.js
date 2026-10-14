const db = require("../config/database");


// --------------------------------------------------
// Create missed-bus temporary authorization
// --------------------------------------------------

const createMissedBusAuthorization = async ({
    studentId,
    alternateBusId,
    validUntil = null,
    createdByUserId = null
}) => {

    // ----------------------------------------------
    // 1. Get student's permanent assignment
    // ----------------------------------------------

    const [assignments] = await db.query(
        `
        SELECT
            ba.id AS assignment_id,
            ba.student_id,
            ba.bus_id AS original_bus_id,
            ba.route_id,

            s.student_id AS student_code,
            s.name AS student_name,

            original_bus.bus_number AS original_bus_number,

            r.route_name,
            r.destination

        FROM bus_assignments ba

        JOIN students s
            ON ba.student_id = s.id

        JOIN buses original_bus
            ON ba.bus_id = original_bus.id

        JOIN routes r
            ON ba.route_id = r.id

        WHERE ba.student_id = ?
          AND ba.assignment_status = 'ACTIVE'
          AND CURDATE() >= ba.valid_from
          AND (
                ba.valid_to IS NULL
                OR CURDATE() <= ba.valid_to
          )

        ORDER BY ba.id DESC
        LIMIT 1
        `,
        [studentId]
    );

    if (assignments.length === 0) {
        throw new Error(
            "Active bus assignment not found for student"
        );
    }

    const assignment = assignments[0];


    // ----------------------------------------------
    // 2. Alternate bus must be different
    // ----------------------------------------------

    if (
        Number(alternateBusId) ===
        Number(assignment.original_bus_id)
    ) {
        throw new Error(
            "Alternate bus must be different from the student's assigned bus"
        );
    }


    // ----------------------------------------------
    // 3. Check alternate bus
    // ----------------------------------------------

    const [buses] = await db.query(
        `
        SELECT
            id,
            bus_number,
            registration_number,
            maximum_capacity,
            status
        FROM buses
        WHERE id = ?
          AND status = 'ACTIVE'
        `,
        [alternateBusId]
    );

    if (buses.length === 0) {
        throw new Error(
            "Alternate bus not found or inactive"
        );
    }

    const alternateBus = buses[0];


    // ----------------------------------------------
    // 4. Check route compatibility
    // ----------------------------------------------

    const [routeMappings] = await db.query(
        `
        SELECT id
        FROM bus_routes
        WHERE bus_id = ?
          AND route_id = ?
          AND status = 'ACTIVE'
        LIMIT 1
        `,
        [
            alternateBusId,
            assignment.route_id
        ]
    );

    if (routeMappings.length === 0) {
        throw new Error(
            "Alternate bus is not permitted on the student's route"
        );
    }


    // ----------------------------------------------
    // 5. Check current successful passengers
    // ----------------------------------------------

    const [passengerRows] = await db.query(
        `
        SELECT COUNT(DISTINCT student_id) AS current_passengers
        FROM boarding_records
        WHERE bus_id = ?
          AND access_result = 'GRANTED'
        `,
        [alternateBusId]
    );

    const currentPassengers =
        Number(passengerRows[0].current_passengers);


    // ----------------------------------------------
    // 6. Check pending permanent assignments
    // ----------------------------------------------

    const [pendingRows] = await db.query(
        `
        SELECT COUNT(DISTINCT ba.student_id) AS pending_students

        FROM bus_assignments ba

        WHERE ba.bus_id = ?
          AND ba.assignment_status = 'ACTIVE'
          AND CURDATE() >= ba.valid_from
          AND (
                ba.valid_to IS NULL
                OR CURDATE() <= ba.valid_to
          )

          AND NOT EXISTS (
              SELECT 1
              FROM boarding_records br
              WHERE br.student_id = ba.student_id
                AND br.bus_id = ba.bus_id
                AND br.access_result = 'GRANTED'
          )
        `,
        [alternateBusId]
    );

    const pendingStudents =
        Number(pendingRows[0].pending_students);


    // ----------------------------------------------
    // 7. Check existing active rescue/missed
    //    authorizations on alternate bus
    // ----------------------------------------------

    const [temporaryRows] = await db.query(
        `
        SELECT COUNT(DISTINCT student_id) AS temporary_students
        FROM temporary_authorizations
        WHERE temporary_bus_id = ?
          AND status = 'ACTIVE'
        `,
        [alternateBusId]
    );

    const temporaryStudents =
        Number(temporaryRows[0].temporary_students);


    // ----------------------------------------------
    // 8. Calculate available capacity
    // ----------------------------------------------

    const availableCapacity =
        Number(alternateBus.maximum_capacity)
        - currentPassengers
        - pendingStudents
        - temporaryStudents;


    if (availableCapacity <= 0) {
        throw new Error(
            "Alternate bus has no available capacity"
        );
    }


    // ----------------------------------------------
    // 9. Prevent duplicate active missed-bus
    //    authorization
    // ----------------------------------------------

    const [existingAuthorization] = await db.query(
        `
        SELECT id
        FROM temporary_authorizations
        WHERE student_id = ?
          AND authorization_type = 'MISSED_BUS'
          AND status = 'ACTIVE'
        LIMIT 1
        `,
        [studentId]
    );

    if (existingAuthorization.length > 0) {
        throw new Error(
            "An active missed-bus authorization already exists for this student"
        );
    }


    // ----------------------------------------------
    // 10. Create temporary authorization
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
        VALUES
        (
            NULL,
            ?,
            ?,
            ?,
            'MISSED_BUS',
            ?,
            'ACTIVE',
            ?,
            ?
        )
        `,
        [
            studentId,
            alternateBusId,
            assignment.route_id,
            "Missed Assigned Bus",
            validUntil,
            createdByUserId
        ]
    );


    // ----------------------------------------------
    // 11. Return complete result
    // ----------------------------------------------

    return {
        authorization_id: result.insertId,

        student_id:
            assignment.student_id,

        student_code:
            assignment.student_code,

        student_name:
            assignment.student_name,

        original_bus_id:
            assignment.original_bus_id,

        original_bus_number:
            assignment.original_bus_number,

        temporary_bus_id:
            alternateBus.id,

        temporary_bus_number:
            alternateBus.bus_number,

        route_id:
            assignment.route_id,

        route_name:
            assignment.route_name,

        destination:
            assignment.destination,

        authorization_type:
            "MISSED_BUS",

        purpose:
            "Missed Assigned Bus",

        status:
            "ACTIVE",

        available_capacity_after_authorization:
            availableCapacity - 1,

        valid_until:
            validUntil,

        created_by_user_id:
            createdByUserId
    };
};


// --------------------------------------------------
// Get missed-bus authorizations
// --------------------------------------------------

const getMissedBusAuthorizations = async () => {

    const [rows] = await db.query(
        `
        SELECT
            ta.id,
            ta.student_id,

            s.student_id AS student_code,
            s.name AS student_name,

            b.bus_number AS temporary_bus_number,

            r.route_name,
            r.destination,

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

        WHERE ta.authorization_type = 'MISSED_BUS'

        ORDER BY ta.id DESC
        `
    );

    return rows;
};


module.exports = {
    createMissedBusAuthorization,
    getMissedBusAuthorizations
};