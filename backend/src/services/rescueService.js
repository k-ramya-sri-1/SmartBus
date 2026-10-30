const db = require("../config/database");
const capacityService = require("./capacityService");

/*
    PHASE 17
    Rescue Bus Allocation Engine

    Main responsibilities:
    1. Find students who actually boarded the affected bus.
    2. Find other active buses.
    3. Calculate their available rescue capacity.
    4. Check distance.
    5. Check route/destination compatibility.
    6. Distribute affected students across buses.
    7. Save allocations.
*/


// --------------------------------------------------
// Helper: Calculate distance between two coordinates
// Haversine formula
// --------------------------------------------------

const calculateDistanceKm = (
    latitude1,
    longitude1,
    latitude2,
    longitude2
) => {

    const earthRadiusKm = 6371;

    const lat1 = latitude1 * Math.PI / 180;
    const lat2 = latitude2 * Math.PI / 180;

    const deltaLat =
        (latitude2 - latitude1) * Math.PI / 180;

    const deltaLon =
        (longitude2 - longitude1) * Math.PI / 180;

    const a =
        Math.sin(deltaLat / 2) *
        Math.sin(deltaLat / 2) +
        Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(deltaLon / 2) *
        Math.sin(deltaLon / 2);

    const c =
        2 * Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return earthRadiusKm * c;
};


// --------------------------------------------------
// Get emergency event
// --------------------------------------------------

const getEmergencyEvent = async (emergencyEventId) => {

    const [events] = await db.query(
        `SELECT
            e.id,
            e.bus_id,
            e.event_type,
            e.description,
            e.latitude,
            e.longitude,
            e.status,
            b.bus_number,
            b.registration_number
         FROM emergency_events e
         JOIN buses b
            ON e.bus_id = b.id
         WHERE e.id = ?`,
        [emergencyEventId]
    );

    if (events.length === 0) {
        throw new Error("Emergency event not found");
    }

    return events[0];
};


// --------------------------------------------------
// Find students who actually boarded affected bus
// --------------------------------------------------

const getAffectedStudents = async (busId) => {

    const [students] = await db.query(
        `SELECT DISTINCT
            br.student_id,
            s.student_id AS student_code,
            s.name AS student_name,
            br.route_id,
            r.route_name,
            r.destination,
            MAX(br.boarded_at) AS last_boarded_at
         FROM boarding_records br
         JOIN students s
            ON br.student_id = s.id
         JOIN routes r
            ON br.route_id = r.id
         WHERE br.bus_id = ?
           AND br.access_result = 'GRANTED'
         GROUP BY
            br.student_id,
            s.student_id,
            s.name,
            br.route_id,
            r.route_name,
            r.destination
         ORDER BY br.student_id`,
        [busId]
    );

    return students;
};


// --------------------------------------------------
// Get candidate rescue buses
// --------------------------------------------------

const getCandidateBuses = async (
    affectedBusId,
    emergencyLatitude,
    emergencyLongitude,
    maxDistanceKm
) => {

    const [buses] = await db.query(
        `SELECT
            b.id,
            b.bus_number,
            b.registration_number,
            b.maximum_capacity,
            b.status,
            gl.latitude,
            gl.longitude,
            gl.recorded_at
         FROM buses b
         LEFT JOIN gps_locations gl
            ON gl.id = (
                SELECT gl2.id
                FROM gps_locations gl2
                WHERE gl2.bus_id = b.id
                ORDER BY gl2.recorded_at DESC
                LIMIT 1
            )
         WHERE b.id <> ?
           AND b.status = 'ACTIVE'
         ORDER BY b.id`,
        [
            affectedBusId
        ]
    );

    return buses.filter(bus => {

        // A rescue bus must have a GPS location
        if (
            bus.latitude === null ||
            bus.longitude === null
        ) {
            return false;
        }

        const distance = calculateDistanceKm(
            Number(emergencyLatitude),
            Number(emergencyLongitude),
            Number(bus.latitude),
            Number(bus.longitude)
        );

        return distance <= maxDistanceKm;
    });
};


// --------------------------------------------------
// Calculate current passengers
// --------------------------------------------------

// Delegated to capacityService so the formula in report section 4.10 has
// exactly one implementation in the codebase.
const getCurrentPassengers = (busId) => capacityService.getCurrentPassengers(busId);


// --------------------------------------------------
// Calculate pending assigned students
// --------------------------------------------------

const getPendingAssignedStudents = (busId) => capacityService.getPendingAssignedStudents(busId);


// --------------------------------------------------
// Calculate already allocated rescue students
// --------------------------------------------------

const getAllocatedRescueStudents = (busId) => capacityService.getAllocatedRescueStudents(busId);


// --------------------------------------------------
// Check route compatibility
// --------------------------------------------------

const checkRouteCompatibility = async (
    busId,
    routeId,
    executor = db
) => {

    const [routes] = await executor.query(
        `SELECT id
         FROM bus_routes
         WHERE bus_id = ?
           AND route_id = ?
           AND status = 'ACTIVE'
         LIMIT 1`,
        [
            busId,
            routeId
        ]
    );

    return routes.length > 0;
};


// --------------------------------------------------
// Allocate rescue students
// --------------------------------------------------

const allocateRescueStudentsUnlocked = async ({
    emergencyEventId,
    maxDistanceKm = 20
}) => {

    // ----------------------------------------------
    // 1. Get emergency
    // ----------------------------------------------

    const emergency =
        await getEmergencyEvent(
            emergencyEventId
        );

    // ----------------------------------------------
    // 2. Emergency must be active
    // ----------------------------------------------

    if (
        emergency.status !== "OPEN" &&
        emergency.status !== "IN_PROGRESS"
    ) {
        throw new Error(
            "Emergency must be OPEN or IN_PROGRESS"
        );
    }

    // ----------------------------------------------
    // 3. Find affected students
    // ----------------------------------------------

    const affectedStudents =
        await getAffectedStudents(
            emergency.bus_id
        );

    if (affectedStudents.length === 0) {

        return {
            emergency,
            affected_students: [],
            affected_student_count: 0,
            rescue_buses: [],
            allocations: [],
            unallocated_students: []
        };
    }

    // ----------------------------------------------
    // 4. Find rescue buses
    // ----------------------------------------------

    const candidateBuses =
        await getCandidateBuses(
            emergency.bus_id,
            emergency.latitude,
            emergency.longitude,
            Number(maxDistanceKm)
        );

    // ----------------------------------------------
    // 5. Build bus capacity information
    // ----------------------------------------------

    const rescueBuses = [];

    for (const bus of candidateBuses) {

        const currentPassengers =
            await getCurrentPassengers(bus.id);

        const pendingAssignedStudents =
            await getPendingAssignedStudents(
                bus.id
            );

        const alreadyAllocatedRescueStudents =
            await getAllocatedRescueStudents(
                bus.id
            );

        const rescueCapacity =
            Number(bus.maximum_capacity) -
            currentPassengers -
            pendingAssignedStudents -
            alreadyAllocatedRescueStudents;

        const distanceKm =
            calculateDistanceKm(
                Number(emergency.latitude),
                Number(emergency.longitude),
                Number(bus.latitude),
                Number(bus.longitude)
            );

        rescueBuses.push({
            bus_id: bus.id,
            bus_number: bus.bus_number,
            registration_number:
                bus.registration_number,

            maximum_capacity:
                Number(bus.maximum_capacity),

            current_passengers:
                currentPassengers,

            pending_assigned_students:
                pendingAssignedStudents,

            already_allocated_rescue_students:
                alreadyAllocatedRescueStudents,

            rescue_capacity:
                Math.max(0, rescueCapacity),

            latitude:
                Number(bus.latitude),

            longitude:
                Number(bus.longitude),

            distance_km:
                Number(distanceKm.toFixed(3))
        });
    }

    // ----------------------------------------------
    // 6. Sort nearest buses first
    // ----------------------------------------------

    rescueBuses.sort(
        (a, b) =>
            a.distance_km - b.distance_km
    );

    // ----------------------------------------------
    // 7. Allocate students
    // ----------------------------------------------

    const allocations = [];
    const unallocatedStudents = [];

    for (const student of affectedStudents) {

        let allocated = false;

        for (const bus of rescueBuses) {

            if (bus.rescue_capacity <= 0) {
                continue;
            }

            // Route compatibility
            const routeCompatible =
                await checkRouteCompatibility(
                    bus.bus_id,
                    student.route_id
                );

            if (!routeCompatible) {
                continue;
            }

            const allocation = await capacityService.withBusCapacityLock(
                bus.bus_id,
                async (connection) => {
                    const capacity = await capacityService.getBusCapacity(
                        bus.bus_id,
                        connection
                    );

                    if (!capacity || capacity.rescue_capacity <= 0) {
                        return null;
                    }

                    if (!(await checkRouteCompatibility(
                        bus.bus_id,
                        student.route_id,
                        connection
                    ))) {
                        return null;
                    }

                    const [existing] = await connection.query(
                        `SELECT id
                           FROM rescue_allocations
                          WHERE emergency_event_id = ?
                            AND student_id = ?
                            AND allocation_status IN ('ALLOCATED', 'BOARDED')
                          LIMIT 1`,
                        [emergencyEventId, student.student_id]
                    );

                    if (existing.length > 0) {
                        return { insertId: existing[0].id, duplicate: true };
                    }

                    const [result] = await connection.query(
                        `INSERT INTO rescue_allocations
                        (
                            emergency_event_id,
                            student_id,
                            rescue_bus_id,
                            allocation_status
                        )
                        VALUES (?, ?, ?, 'ALLOCATED')`,
                        [
                            emergencyEventId,
                            student.student_id,
                            bus.bus_id
                        ]
                    );

                    return { insertId: result.insertId, duplicate: false };
                }
            );

            if (!allocation) {
                continue;
            }

            // Reduce available rescue capacity
            if (!allocation.duplicate) {
                bus.rescue_capacity -= 1;
            }

            allocations.push({
                allocation_id:
                allocation.insertId,

                student_id:
                    student.student_id,

                student_code:
                    student.student_code,

                student_name:
                    student.student_name,

                original_bus_id:
                    emergency.bus_id,

                rescue_bus_id:
                    bus.bus_id,

                rescue_bus_number:
                    bus.bus_number,

                route_id:
                    student.route_id,

                route_name:
                    student.route_name,

                destination:
                    student.destination
            });

            allocated = true;

            break;
        }

        if (!allocated) {

            unallocatedStudents.push({
                student_id:
                    student.student_id,

                student_code:
                    student.student_code,

                student_name:
                    student.student_name,

                route_id:
                    student.route_id,

                route_name:
                    student.route_name,

                destination:
                    student.destination
            });
        }
    }

    return {
        emergency: {
            id: emergency.id,
            bus_id: emergency.bus_id,
            bus_number: emergency.bus_number,
            event_type: emergency.event_type,
            latitude: emergency.latitude,
            longitude: emergency.longitude,
            status: emergency.status
        },

        affected_student_count:
            affectedStudents.length,

        allocated_student_count:
            allocations.length,

        unallocated_student_count:
            unallocatedStudents.length,

        rescue_buses:
            rescueBuses,

        allocations,

        unallocated_students:
            unallocatedStudents
    };
};

const allocateRescueStudents = async (params) =>
    capacityService.withEmergencyAllocationLock(
        params.emergencyEventId,
        () => allocateRescueStudentsUnlocked(params)
    );


module.exports = {
    allocateRescueStudents,
    calculateDistanceKm
};