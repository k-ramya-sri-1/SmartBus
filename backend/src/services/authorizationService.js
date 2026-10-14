const db = require("../config/database");

/*
    Access Decision Engine

    Checks:
    1. Student exists and is active
    2. RFID is valid and belongs to student
    3. Face verification is successful
    4. Student has an active bus assignment
    5. Correct bus
    6. Correct route

    Returns:
    {
        authorized: true/false,
        reason: null or denial reason
    }
*/

const checkAuthorization = async ({
    student_id,
    bus_id,
    route_id,
    rfid_card_id,
    face_verified
}) => {

    // --------------------------------------------------
    // 1. Check student
    // --------------------------------------------------

    const [students] = await db.query(
        `SELECT
            id,
            student_id,
            name,
            status
         FROM students
         WHERE id = ?`,
        [student_id]
    );

    if (students.length === 0) {
        return {
            authorized: false,
            reason: "NO_AUTHORIZATION",
            message: "Student not found"
        };
    }

    const student = students[0];

    // --------------------------------------------------
    // 2. Check student active status
    // --------------------------------------------------

    if (student.status !== "ACTIVE") {
        return {
            authorized: false,
            reason: "STUDENT_INACTIVE",
            message: "Student account is inactive"
        };
    }

    // --------------------------------------------------
    // 3. Check RFID
    // --------------------------------------------------

    if (!rfid_card_id) {
        return {
            authorized: false,
            reason: "INVALID_RFID",
            message: "RFID card ID is required"
        };
    }

    const [rfidCards] = await db.query(
        `SELECT
            id,
            student_id,
            rfid_uid,
            status
         FROM rfid_cards
         WHERE id = ?`,
        [rfid_card_id]
    );

    if (rfidCards.length === 0) {
        return {
            authorized: false,
            reason: "INVALID_RFID",
            message: "RFID card not found"
        };
    }

    const rfidCard = rfidCards[0];

    // RFID must belong to the student
    if (rfidCard.student_id !== Number(student_id)) {
        return {
            authorized: false,
            reason: "INVALID_RFID",
            message: "RFID card does not belong to this student"
        };
    }

    // RFID must be active
    if (rfidCard.status !== "ACTIVE") {
        return {
            authorized: false,
            reason: "INVALID_RFID",
            message: "RFID card is not active"
        };
    }

    // --------------------------------------------------
    // 4. Check face verification
    // --------------------------------------------------

    if (face_verified !== true) {
        return {
            authorized: false,
            reason: "FACE_MISMATCH",
            message: "Face verification failed"
        };
    }

    // --------------------------------------------------
    // 5. Check active bus assignment
    // --------------------------------------------------

    const [assignments] = await db.query(
        `SELECT
            ba.id,
            ba.student_id,
            ba.bus_id,
            ba.route_id,
            ba.assignment_status,
            ba.valid_from,
            ba.valid_to
         FROM bus_assignments ba
         WHERE ba.student_id = ?
           AND ba.assignment_status = 'ACTIVE'
           AND CURDATE() >= ba.valid_from
           AND (ba.valid_to IS NULL OR CURDATE() <= ba.valid_to)
         ORDER BY ba.id DESC
         LIMIT 1`,
        [student_id]
    );

    if (assignments.length === 0) {
        return {
            authorized: false,
            reason: "NO_AUTHORIZATION",
            message: "Student has no active bus authorization"
        };
    }

    const assignment = assignments[0];

    // --------------------------------------------------
    // 6. Check correct bus
    // --------------------------------------------------

    if (Number(assignment.bus_id) !== Number(bus_id)) {
        return {
            authorized: false,
            reason: "WRONG_BUS",
            message: "Student is not assigned to this bus"
        };
    }

    // --------------------------------------------------
    // 7. Check correct route
    // --------------------------------------------------

    if (Number(assignment.route_id) !== Number(route_id)) {
        return {
            authorized: false,
            reason: "INVALID_ROUTE",
            message: "Student is not authorized for this route"
        };
    }

    // --------------------------------------------------
    // 8. All checks passed
    // --------------------------------------------------

    return {
        authorized: true,
        reason: null,
        message: "Access granted",
        student: {
            id: student.id,
            student_id: student.student_id,
            name: student.name
        },
        assignment: {
            assignment_id: assignment.id,
            bus_id: assignment.bus_id,
            route_id: assignment.route_id
        }
    };
};


module.exports = {
    checkAuthorization
};