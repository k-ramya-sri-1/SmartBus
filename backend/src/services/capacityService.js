/**
 * Bus capacity arithmetic, in one place.
 *
 * Report section 4.10 defines rescue capacity as:
 *
 *   Rescue Capacity = Maximum Operational Capacity
 *                   - Current Passengers
 *                   - Pending Assigned Students
 *                   - Already Allocated Rescue Students
 *
 * The rescue engine and the Fest Mode rule both use this, so the formula must
 * not be reimplemented per caller.
 */

const db = require("../config/database");

const BUS_LOCK_PREFIX = "smartbus:access:";
const EMERGENCY_LOCK_PREFIX = "smartbus:rescue-emergency:";

async function withEmergencyAllocationLock(emergencyEventId, operation) {
    const connection = await db.getConnection();
    const lockName = `${EMERGENCY_LOCK_PREFIX}${Number(emergencyEventId)}`;
    let acquired = false;

    try {
        const [lockRows] = await connection.query(
            "SELECT GET_LOCK(?, 10) AS acquired",
            [lockName]
        );

        acquired = Number(lockRows[0]?.acquired) === 1;

        if (!acquired) {
            const error = new Error("The emergency allocation lock could not be acquired.");
            error.code = "RESCUE_ALLOCATION_BUSY";
            error.statusCode = 503;
            throw error;
        }

        return await operation();
    } finally {
        if (acquired) {
            await connection.query(
                "SELECT RELEASE_LOCK(?)",
                [lockName]
            ).catch(() => {});
        }
        connection.release();
    }
}

async function withBusCapacityLock(busId, operation) {
    const connection = await db.getConnection();
    const lockName = `${BUS_LOCK_PREFIX}${Number(busId)}`;
    let acquired = false;

    try {
        const [lockRows] = await connection.query(
            "SELECT GET_LOCK(?, 10) AS acquired",
            [lockName]
        );

        acquired = Number(lockRows[0]?.acquired) === 1;

        if (!acquired) {
            const error = new Error("The bus capacity lock could not be acquired.");
            error.code = "CAPACITY_BUSY";
            error.statusCode = 503;
            throw error;
        }

        await connection.beginTransaction();

        // Keep a row lock as an additional guard against bus updates while
        // capacity is calculated and the reservation is inserted.
        await connection.query(
            "SELECT id FROM buses WHERE id = ? FOR UPDATE",
            [busId]
        );

        const result = await operation(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        if (acquired) {
            await connection.query(
                "SELECT RELEASE_LOCK(?)",
                [lockName]
            ).catch(() => {});
        }
        connection.release();
    }
}

async function getMaximumCapacity(busId, executor = db) {
    const [rows] = await executor.query("SELECT maximum_capacity FROM buses WHERE id = ? LIMIT 1", [busId]);

    if (rows.length === 0) {
        return null;
    }

    return Number(rows[0].maximum_capacity);
}

/**
 * Students who actually boarded this bus and whose most recent result was a
 * granted access. Counted once per student.
 */
async function getCurrentPassengers(busId, executor = db) {
    const [rows] = await executor.query(
        `SELECT COUNT(DISTINCT student_id) AS count
           FROM boarding_records
          WHERE bus_id = ?
            AND access_result = 'GRANTED'
            AND student_id IS NOT NULL`,
        [busId]
    );

    return Number(rows[0].count);
}

async function getPendingAssignedStudents(busId, executor = db) {
    const [rows] = await executor.query(
        `SELECT COUNT(DISTINCT ba.student_id) AS count
           FROM bus_assignments ba
          WHERE ba.bus_id = ?
            AND ba.assignment_status = 'ACTIVE'
            AND CURDATE() >= ba.valid_from
            AND (ba.valid_to IS NULL OR CURDATE() <= ba.valid_to)
            AND NOT EXISTS (
                 SELECT 1
                   FROM boarding_records br
                  WHERE br.student_id = ba.student_id
                    AND br.bus_id = ba.bus_id
                    AND br.access_result = 'GRANTED'
            )`,
        [busId]
    );

    return Number(rows[0].count);
}

async function getAllocatedRescueStudents(busId, executor = db) {
    const [rows] = await executor.query(
        `SELECT COUNT(DISTINCT student_id) AS count
           FROM rescue_allocations
          WHERE rescue_bus_id = ?
            AND allocation_status = 'ALLOCATED'`,
        [busId]
    );

    return Number(rows[0].count);
}

/**
 * Full capacity picture for one bus, with the parts that make it up.
 */
async function getBusCapacity(busId, executor = db) {
    const maximum = await getMaximumCapacity(busId, executor);

    if (maximum === null) {
        return null;
    }

    const currentPassengers = await getCurrentPassengers(busId, executor);
    const pendingAssigned = await getPendingAssignedStudents(busId, executor);
    const allocatedRescue = await getAllocatedRescueStudents(busId, executor);

    const rescueCapacity = maximum - currentPassengers - pendingAssigned - allocatedRescue;

    return {
        bus_id: Number(busId),
        maximum_capacity: maximum,
        current_passengers: currentPassengers,
        pending_assigned_students: pendingAssigned,
        already_allocated_rescue_students: allocatedRescue,
        rescue_capacity: Math.max(0, rescueCapacity)
    };
}

module.exports = {
    withEmergencyAllocationLock,
    withBusCapacityLock,
    getMaximumCapacity,
    getCurrentPassengers,
    getPendingAssignedStudents,
    getAllocatedRescueStudents,
    getBusCapacity
};
