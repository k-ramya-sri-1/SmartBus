/**
 * Fixtures for the integration tests.
 *
 * The data set is deliberately small and explicit so every assertion in
 * access.test.js can be read against it:
 *
 *   student 1 (Alice)  bus 1, route 1, card TESTCARD01, enrolled face A
 *   student 2 (Bob)    bus 1, route 1, card TESTCARD02, enrolled face B
 *   student 3 (Carol)  inactive student
 *   bus 3              serves route 2, capacity 1 (Fest Mode capacity test)
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const bcrypt = require(path.join(__dirname, "..", "node_modules", "bcrypt"));
const jwt = require(path.join(__dirname, "..", "node_modules", "jsonwebtoken"));

const { getPool, REPO_DIR } = require("./harness");
const { hashDeviceKey, generateDeviceKey } = require("../src/middleware/deviceAuth");
const config = require("../src/config/env");

const FIXTURE_DIR = path.join(REPO_DIR, "face-service", "tests", "fixtures");

// Generated at runtime so the repository never contains a test password.
const STAFF_PASSWORD = crypto.randomBytes(18).toString("hex");

function readFixture(name) {
    return fs.readFileSync(path.join(FIXTURE_DIR, name));
}

async function seed() {
    const pool = getPool();
    const passwordHash = await bcrypt.hash(STAFF_PASSWORD, 10);
    const device1Key = generateDeviceKey();
    const device2Key = generateDeviceKey();
    const device3Key = generateDeviceKey();

    await pool.query(
        `INSERT INTO students (id, student_id, name, email, phone, status) VALUES
            (1, 'S001', 'Alice Test', 'alice@test.local', NULL, 'ACTIVE'),
            (2, 'S002', 'Bob Test', 'bob@test.local', NULL, 'ACTIVE'),
            (3, 'S003', 'Carol Inactive', 'carol@test.local', NULL, 'INACTIVE'),
            (4, 'S004', 'Dave Test', 'dave@test.local', NULL, 'ACTIVE')`
    );

    await pool.query(
        `INSERT INTO rfid_cards (id, student_id, rfid_uid, status) VALUES
            (1, 1, 'TESTCARD01', 'ACTIVE'),
            (2, 2, 'TESTCARD02', 'ACTIVE'),
            (3, 3, 'TESTCARD03', 'ACTIVE'),
            (4, 1, 'TESTCARD04', 'INACTIVE')`
    );

    await pool.query(
        `INSERT INTO buses (id, bus_number, registration_number, maximum_capacity, status) VALUES
            (1, 'BUS001', 'TS09AB0001', 55, 'ACTIVE'),
            (2, 'BUS002', 'TS09AB0002', 50, 'ACTIVE'),
            (3, 'BUS003', 'TS09AB0003', 1, 'ACTIVE')`
    );

    await pool.query(
        `INSERT INTO routes (id, route_name, starting_point, destination, status) VALUES
            (1, 'Route A', 'CBIT', 'Mehdipatnam', 'ACTIVE'),
            (2, 'Route B', 'Secunderabad', 'Gachibowli', 'ACTIVE')`
    );

    await pool.query(
        `INSERT INTO bus_routes (bus_id, route_id, status) VALUES
            (1, 1, 'ACTIVE'),
            (2, 1, 'ACTIVE'),
            (2, 2, 'ACTIVE'),
            (3, 2, 'ACTIVE')`
    );

    await pool.query(
        `INSERT INTO bus_assignments (student_id, bus_id, route_id, assignment_status, valid_from, valid_to) VALUES
            (1, 1, 1, 'ACTIVE', '2020-01-01', NULL),
            (2, 1, 1, 'ACTIVE', '2020-01-01', NULL),
            (3, 1, 1, 'ACTIVE', '2020-01-01', NULL)`
    );

    await pool.query(
        `INSERT INTO users (id, username, email, password_hash, role, status) VALUES
            (1, 'admin_test', 'admin@test.local', ?, 'ADMIN', 'ACTIVE'),
            (2, 'manager_test', 'manager@test.local', ?, 'TRANSPORT_MANAGER', 'ACTIVE'),
            (3, 'driver_test', 'driver@test.local', ?, 'DRIVER', 'ACTIVE')`,
        [passwordHash, passwordHash, passwordHash]
    );

    await pool.query(
        `INSERT INTO devices (id, device_uid, bus_id, api_key_hash, label, status) VALUES
            (1, 'TEST-DEVICE-01', 1, ?, 'Bus 1 reader', 'ACTIVE'),
            (2, 'TEST-DEVICE-02', 2, ?, 'Bus 2 reader', 'ACTIVE'),
            (3, 'TEST-DEVICE-03', 3, ?, 'Bus 3 reader', 'ACTIVE'),
            (4, 'TEST-DEVICE-OFF', 1, ?, 'Revoked reader', 'REVOKED')`,
        [
            hashDeviceKey(device1Key),
            hashDeviceKey(device2Key),
            hashDeviceKey(device3Key),
            hashDeviceKey("0".repeat(64))
        ]
    );

    const staffToken = (user) => jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        config.jwtSecret,
        { expiresIn: "1h" }
    );

    return {
        // Staff credentials are exported from this module (STAFF_PASSWORD)
        // rather than returned here, so the fixture carries no
        // credential-shaped field.
        tokens: {
            admin: staffToken({ id: 1, username: "admin_test", role: "ADMIN" }),
            manager: staffToken({ id: 2, username: "manager_test", role: "TRANSPORT_MANAGER" }),
            driver: staffToken({ id: 3, username: "driver_test", role: "DRIVER" })
        },
        devices: {
            bus1: { device_uid: "TEST-DEVICE-01", device_key: device1Key, id: 1, bus_id: 1 },
            bus2: { device_uid: "TEST-DEVICE-02", device_key: device2Key, id: 2, bus_id: 2 },
            bus3: { device_uid: "TEST-DEVICE-03", device_key: device3Key, id: 3, bus_id: 3 },
            revoked: { device_uid: "TEST-DEVICE-OFF", device_key: "0".repeat(64), id: 4, bus_id: 1 }
        },
        images: {
            alice: readFixture("person_a.jpg"),
            bob: readFixture("person_b.jpg"),
            noFace: readFixture("no_face.jpg")
        },
        ids: { alice: 1, bob: 2, carol: 3, dave: 4 }
    };
}

async function resetAll() {
    const pool = getPool();
    const tables = [
        "boarding_records",
        "face_verifications",
        "gps_locations",
        "emergency_events",
        "temporary_authorizations",
        "rescue_allocations",
        "route_waypoints",
        "bus_assignments",
        "face_profiles",
        "rfid_cards",
        "devices",
        "students",
        "buses",
        "routes",
        "bus_routes",
        "users",
        "system_settings"
    ];

    await pool.query("SET FOREIGN_KEY_CHECKS = 0");

    for (const table of tables) {
        await pool.query(`TRUNCATE TABLE ${table}`);
    }

    await pool.query("SET FOREIGN_KEY_CHECKS = 1");
}

module.exports = {
    seed,
    resetAll,
    STAFF_PASSWORD,
    FIXTURE_DIR
};
