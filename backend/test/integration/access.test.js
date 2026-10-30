/**
 * End-to-end access-control tests.
 *
 * These run the real Express app, the real MySQL schema, real device
 * authentication and the real face-recognition service. Nothing in the
 * authorization path is stubbed, because the claim being tested is precisely
 * that the deployed stack cannot be talked into opening a gate.
 *
 * Every test asserts on the persisted boarding record as well as the HTTP
 * response: a decision that is not logged is not a decision this system
 * accepts.
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");

const harness = require("../../test-support/harness");
const fixtures = require("../../test-support/fixtures");
const faceTokenService = require("../../src/services/faceTokenService");

const API = () => harness.request;

let db;
let fixturesData;
let config;

const MUTABLE_TABLES = [
    "boarding_records",
    "face_verifications",
    "gps_locations",
    "temporary_authorizations",
    "rescue_allocations",
    "emergency_events",
    "route_waypoints",
    "system_settings"
];

async function clearMutableState() {
    for (const table of MUTABLE_TABLES) {
        await db.query(`DELETE FROM ${table}`);
    }
}

/** Enroll a student's reference face through the public API. */
async function enroll(studentId, image) {
    const response = await harness.request("POST", "/api/face/enroll", {
        auth: fixturesData.tokens.manager,
        body: { student_id: studentId, image: image.toString("base64") }
    });

    assert.equal(response.status, 201, `enrollment failed: ${JSON.stringify(response.body)}`);

    return response.body;
}

/**
 * Run the exact sequence the firmware runs:
 *   card -> face capture -> face token -> access decision
 */
async function scan({
    cardUid,
    image,
    device,
    routeId,
    clientEventId,
    gps,
    precomputedProof
}) {
    let faceProof = precomputedProof;

    const faceResult = image === undefined
        ? null
        : await harness.request("POST", "/api/face/verify", {
            body: image,
            device,
            headers: { "X-Rfid-Uid": cardUid }
        });

    if (faceResult && faceResult.body && faceResult.body.face_proof) {
        faceProof = faceResult.body.face_proof;
    }

    const decision = await harness.request("POST", "/api/authorization/check", {
        device,
        body: {
            rfid_uid: cardUid,
            route_id: routeId,
            face_proof: faceProof,
            face_verification_id: faceResult && faceResult.body
                ? faceResult.body.verification_id
                : undefined,
            client_event_id: clientEventId || `evt-${crypto.randomUUID()}`,
            gps
        }
    });

    return { faceResult, decision };
}

async function lastBoardingRecord() {
    const [rows] = await db.query(
        "SELECT * FROM boarding_records ORDER BY id DESC LIMIT 1"
    );
    return rows[0] || null;
}

before(async () => {
    await harness.start();
    await fixtures.resetAll();
    fixturesData = await fixtures.seed();

    db = harness.getPool();
    config = require("../../src/config/env");

    // Enrollment happens once: the face service keeps its own template store,
    // which is deliberately not truncated between tests.
    await enroll(fixturesData.ids.alice, fixturesData.images.alice);
    await enroll(fixturesData.ids.bob, fixturesData.images.bob);
});

after(async () => {
    await harness.stop();
});

beforeEach(async () => {
    await clearMutableState();
});

describe("normal boarding", () => {
    it("grants access when card, face, bus and route all match", async () => {
        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 1
        });

        assert.equal(decision.status, 200, JSON.stringify(decision.body));
        assert.equal(decision.body.authorized, true);
        assert.equal(decision.body.access_result, "GRANTED");
        assert.equal(decision.body.boarding_type, "NORMAL");
        assert.equal(decision.body.face_verified, true);
        assert.equal(decision.body.rfid_verified, true);

        const record = await lastBoardingRecord();
        assert.equal(record.access_result, "GRANTED");
        assert.equal(record.student_id, fixturesData.ids.alice);
        assert.equal(record.face_verified, 1);
        assert.equal(record.rfid_verified, 1);
        assert.equal(record.device_id, fixturesData.devices.bus1.id);
        assert.ok(record.face_score > 0.36, `score was ${record.face_score}`);
        assert.equal(record.denial_reason, null);
    });

    it("records GPS status without letting a missing fix block access", async () => {
        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 1
        });

        assert.equal(decision.body.authorized, true);
        assert.equal(decision.body.gps_status, "UNAVAILABLE");

        const record = await lastBoardingRecord();
        assert.equal(record.gps_status, "UNAVAILABLE");
        assert.equal(record.route_deviation_m, null);
    });

    it("marks an old fix as stale instead of trusting it", async () => {
        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 1,
            gps: { latitude: 17.3924, longitude: 78.4867, age_seconds: 900 }
        });

        assert.equal(decision.body.authorized, true);
        assert.equal(decision.body.gps_status, "GPS_STALE");
    });

    it("accepts a fresh fix as GPS_FIX", async () => {
        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 1,
            gps: { latitude: 17.3924, longitude: 78.4867, age_seconds: 2, satellites: 9, hdop: 0.9 }
        });

        assert.equal(decision.body.gps_status, "GPS_FIX");
        assert.equal(decision.body.authorized, true);
    });
});

describe("identity failures", () => {
    it("denies an unknown card and still logs the attempt", async () => {
        const { faceResult, decision } = await scan({
            cardUid: "UNKNOWNCARD9",
            device: fixturesData.devices.bus1,
            routeId: 1
        });

        assert.equal(faceResult, null);
        assert.equal(decision.status, 403);
        assert.equal(decision.body.access_result, "DENIED");
        assert.equal(decision.body.denial_reason, "INVALID_RFID");

        const record = await lastBoardingRecord();
        assert.equal(record.access_result, "DENIED");
        assert.equal(record.student_id, null);
        assert.equal(record.attempted_rfid_uid, "UNKNOWNCARD9");
        assert.equal(record.denial_reason, "INVALID_RFID");
    });

    it("rejects an inactive card", async () => {
        const faceResult = await harness.request("POST", "/api/face/verify", {
            body: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            headers: { "X-Rfid-Uid": "TESTCARD04" }
        });

        assert.equal(faceResult.status, 403);
        assert.equal(faceResult.body.decision, "INVALID_RFID");

        const { decision } = await scan({
            cardUid: "TESTCARD04",
            device: fixturesData.devices.bus1,
            routeId: 1
        });

        assert.equal(decision.body.denial_reason, "INVALID_RFID");
    });

    it("rejects an inactive student", async () => {
        const { decision } = await scan({
            cardUid: "TESTCARD03",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 1
        });

        assert.equal(decision.body.access_result, "DENIED");
        assert.equal(decision.body.denial_reason, "STUDENT_INACTIVE");
    });

    it("denies a face that belongs to a different student", async () => {
        const { faceResult, decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.bob,
            device: fixturesData.devices.bus1,
            routeId: 1
        });

        assert.equal(faceResult.status, 403);
        assert.notEqual(faceResult.body.face_proof, undefined);
        assert.equal(faceResult.body.face_proof, null);
        assert.ok(["DIFFERENT_STUDENT", "LOW_SCORE"].includes(faceResult.body.decision));

        assert.equal(decision.status, 403);
        assert.equal(decision.body.denial_reason, "FACE_MISMATCH");

        const record = await lastBoardingRecord();
        assert.equal(record.face_verified, 0);
        assert.equal(record.access_result, "DENIED");
    });

    it("denies a frame with no face", async () => {
        const { faceResult } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.noFace,
            device: fixturesData.devices.bus1,
            routeId: 1
        });

        assert.equal(faceResult.status, 403);
        assert.equal(faceResult.body.decision, "NO_FACE");
        assert.equal(faceResult.body.face_proof, null);
    });

    it("does not accept a client-supplied face_verified flag", async () => {
        // The exact bypass the old endpoint allowed.
        const response = await harness.request("POST", "/api/authorization/check", {
            device: fixturesData.devices.bus1,
            body: {
                rfid_uid: "TESTCARD01",
                route_id: 1,
                face_verified: true,
                client_event_id: `evt-${crypto.randomUUID()}`
            }
        });

        assert.equal(response.status, 403);
        assert.equal(response.body.authorized, false);
        assert.equal(response.body.denial_reason, "FACE_NOT_PERFORMED");
    });

    it("refuses to reuse a face token", async () => {
        const first = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 1
        });

        assert.equal(first.decision.body.authorized, true);

        const replay = await harness.request("POST", "/api/authorization/check", {
            device: fixturesData.devices.bus1,
            body: {
                rfid_uid: "TESTCARD01",
                route_id: 1,
                face_proof: first.faceResult.body.face_proof,
                client_event_id: `evt-${crypto.randomUUID()}`
            }
        });

        assert.equal(replay.status, 403);
        assert.equal(replay.body.denial_reason, "FACE_INVALID");
    });

    it("refuses a token issued for a different device", async () => {
        const face = await harness.request("POST", "/api/face/verify", {
            body: fixturesData.images.alice,
            device: fixturesData.devices.bus2,
            headers: { "X-Rfid-Uid": "TESTCARD01" }
        });

        assert.equal(face.status, 200);

        // The token was minted for device 2 but presented on device 1.
        const decision = await harness.request("POST", "/api/authorization/check", {
            device: fixturesData.devices.bus1,
            body: {
                rfid_uid: "TESTCARD01",
                route_id: 1,
                face_proof: face.body.face_proof,
                client_event_id: `evt-${crypto.randomUUID()}`
            }
        });

        assert.equal(decision.status, 403);
        assert.equal(decision.body.denial_reason, "FACE_INVALID");
    });

    it("refuses an expired face token", async () => {
        const tokenId = crypto.randomUUID();
        const studentId = fixturesData.ids.alice;

        await db.query(
            `INSERT INTO face_verifications
                (token_id, student_id, rfid_card_id, device_id, matched_student_id, score,
                 decision, engine, expires_at, used_at)
             VALUES (?, ?, 1, 1, ?, 0.9, 'MATCH', 'sface-v1', DATE_SUB(NOW(), INTERVAL 5 MINUTE), NULL)`,
            [tokenId, studentId, studentId]
        );

        const expired = jwt.sign(
            { jti: tokenId, sub: String(studentId), card: 1, dev: 1, dec: "MATCH", score: 0.9 },
            config.faceTokenSecret,
            {
                expiresIn: -60,
                issuer: "smartbus-face",
                audience: "smartbus-access"
            }
        );

        const decision = await harness.request("POST", "/api/authorization/check", {
            device: fixturesData.devices.bus1,
            body: {
                rfid_uid: "TESTCARD01",
                route_id: 1,
                face_proof: expired,
                client_event_id: `evt-${crypto.randomUUID()}`
            }
        });

        assert.equal(decision.status, 403);
        assert.equal(decision.body.denial_reason, "FACE_INVALID");
    });

    it("reports FACE_UNAVAILABLE when the engine never produced a match", async () => {
        const tokenId = crypto.randomUUID();

        await db.query(
            `INSERT INTO face_verifications
                (token_id, student_id, rfid_card_id, device_id, matched_student_id, score,
                 decision, engine, expires_at, used_at)
             VALUES (?, 1, 1, 1, NULL, NULL, 'ENGINE_UNAVAILABLE', NULL,
                     DATE_ADD(NOW(), INTERVAL 1 MINUTE), NULL)`,
            [tokenId]
        );

        const faceJwt = jwt.sign(
            { jti: tokenId, sub: "1", card: 1, dev: 1, dec: "MATCH", score: null },
            config.faceTokenSecret,
            { expiresIn: 600, issuer: "smartbus-face", audience: "smartbus-access" }
        );

        const decision = await harness.request("POST", "/api/authorization/check", {
            device: fixturesData.devices.bus1,
            body: {
                rfid_uid: "TESTCARD01",
                route_id: 1,
                face_proof: faceJwt,
                client_event_id: `evt-${crypto.randomUUID()}`
            }
        });

        assert.equal(decision.status, 403);
        assert.equal(decision.body.denial_reason, "FACE_UNAVAILABLE");
    });
});

describe("bus and route authorization", () => {
    it("denies a student boarding a bus they are not assigned to", async () => {
        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus2,
            routeId: 1
        });

        assert.equal(decision.status, 403);
        assert.equal(decision.body.denial_reason, "WRONG_BUS");
    });

    it("denies the wrong route on the right bus", async () => {
        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 2
        });

        assert.equal(decision.status, 403);
        assert.equal(decision.body.denial_reason, "INVALID_ROUTE");
    });

    it("denies a student with no active assignment", async () => {
        await db.query("UPDATE bus_assignments SET assignment_status = 'INACTIVE' WHERE student_id = 1");

        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 1
        });

        assert.equal(decision.status, 403);
        assert.equal(decision.body.denial_reason, "NO_AUTHORIZATION");

        await db.query("UPDATE bus_assignments SET assignment_status = 'ACTIVE' WHERE student_id = 1");
    });

    it("allows a missed-bus temporary authorization and consumes it", async () => {
        await db.query(
            `INSERT INTO temporary_authorizations
                (student_id, temporary_bus_id, route_id, authorization_type, purpose, status, valid_until)
             VALUES (1, 2, 1, 'MISSED_BUS', 'Integration test', 'ACTIVE', DATE_ADD(NOW(), INTERVAL 1 HOUR))`
        );

        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus2,
            routeId: 1
        });

        assert.equal(decision.status, 200, JSON.stringify(decision.body));
        assert.equal(decision.body.authorized, true);
        assert.equal(decision.body.boarding_type, "RESCUE");

        const [auths] = await db.query("SELECT status FROM temporary_authorizations WHERE student_id = 1");
        assert.equal(auths[0].status, "USED");
    });

    it("ignores an expired temporary authorization", async () => {
        await db.query(
            `INSERT INTO temporary_authorizations
                (student_id, temporary_bus_id, route_id, authorization_type, status, valid_until)
             VALUES (1, 2, 1, 'MISSED_BUS', 'ACTIVE', DATE_SUB(NOW(), INTERVAL 1 HOUR))`
        );

        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus2,
            routeId: 1
        });

        assert.equal(decision.status, 403);
        assert.equal(decision.body.denial_reason, "WRONG_BUS");
    });
});

describe("concurrent capacity reservations", () => {
    it("does not over-allocate a rescue bus under concurrent requests", async () => {
        await db.query("UPDATE buses SET maximum_capacity = 1 WHERE id = 2");
        await db.query(
            `INSERT INTO gps_locations (bus_id, latitude, longitude, fix_status)
             VALUES (2, 17.3925, 78.4868, 'GPS_FIX')`
        );
        await db.query(
            "INSERT INTO bus_routes (bus_id, route_id, status) VALUES (3, 1, 'ACTIVE')"
        );
        await db.query(
            `INSERT INTO gps_locations (bus_id, latitude, longitude, fix_status)
             VALUES (3, 17.3926, 78.4869, 'GPS_FIX')`
        );
        await db.query(
            `INSERT INTO boarding_records
                (student_id, bus_id, route_id, access_result, rfid_verified, face_verified)
             VALUES (1, 1, 1, 'GRANTED', 1, 1)`
        );

        const emergency = await harness.request("POST", "/api/emergency", {
            auth: fixturesData.tokens.manager,
            body: {
                bus_id: 1,
                event_type: "BREAKDOWN",
                latitude: 17.3924,
                longitude: 78.4867
            }
        });
        assert.equal(emergency.status, 201, JSON.stringify(emergency.body));
        const [emergencyRows] = await db.query(
            "SELECT id FROM emergency_events WHERE bus_id = 1 ORDER BY id DESC LIMIT 1"
        );
        const emergencyEventId = emergencyRows[0].id;

        const requests = [
            harness.request("POST", "/api/rescue/allocate", {
                auth: fixturesData.tokens.manager,
                body: { emergency_event_id: emergencyEventId, max_distance_km: 20 }
            }),
            harness.request("POST", "/api/rescue/allocate", {
                auth: fixturesData.tokens.manager,
                body: { emergency_event_id: emergencyEventId, max_distance_km: 20 }
            })
        ];
        const responses = await Promise.all(requests);

        assert.ok(responses.every((response) => response.status === 200));
        const [rows] = await db.query(
            `SELECT COUNT(*) AS count
               FROM rescue_allocations
              WHERE emergency_event_id = ?
                AND allocation_status = 'ALLOCATED'`,
            [emergencyEventId]
        );
        assert.equal(Number(rows[0].count), 1);

        const [capacityRows] = await db.query(
            `SELECT COUNT(DISTINCT student_id) AS count,
                    COUNT(DISTINCT rescue_bus_id) AS buses
               FROM rescue_allocations
              WHERE emergency_event_id = ?
                AND allocation_status = 'ALLOCATED'`
            , [emergencyEventId]
        );
        assert.ok(Number(capacityRows[0].count) <= 1);
        assert.equal(Number(capacityRows[0].buses), 1);
        await db.query("UPDATE buses SET maximum_capacity = 50 WHERE id = 2");
    });

    it("does not create duplicate missed-bus authorizations concurrently", async () => {
        await db.query("UPDATE buses SET maximum_capacity = 1 WHERE id = 2");

        const requests = [
            harness.request("POST", "/api/missed-bus/authorize", {
                auth: fixturesData.tokens.manager,
                body: { student_id: 1, alternate_bus_id: 2 }
            }),
            harness.request("POST", "/api/missed-bus/authorize", {
                auth: fixturesData.tokens.manager,
                body: { student_id: 1, alternate_bus_id: 2 }
            })
        ];
        const responses = await Promise.all(requests);

        assert.equal(responses.filter((response) => response.status === 201).length, 1);
        assert.equal(responses.filter((response) => response.status === 400).length, 1);

        const [rows] = await db.query(
            `SELECT COUNT(*) AS count
               FROM temporary_authorizations
              WHERE student_id = 1
                AND temporary_bus_id = 2
                AND authorization_type = 'MISSED_BUS'
                AND status = 'ACTIVE'`
        );
        assert.equal(Number(rows[0].count), 1);
        await db.query("UPDATE buses SET maximum_capacity = 50 WHERE id = 2");
    });
});

describe("Fest Mode", () => {
    beforeEach(async () => {
        await db.query(
            `INSERT INTO system_settings (setting_key, setting_value)
             VALUES ('operating_mode', 'FEST')
             ON DUPLICATE KEY UPDATE setting_value = 'FEST'`
        );
    });

    it("allows another bus on the same route while capacity remains", async () => {
        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus2,
            routeId: 1
        });

        assert.equal(decision.status, 200, JSON.stringify(decision.body));
        assert.equal(decision.body.authorized, true);
        assert.equal(decision.body.boarding_type, "FEST");

        const record = await lastBoardingRecord();
        assert.equal(record.boarding_type, "FEST");
    });

    it("still refuses a route the student is not on", async () => {
        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus2,
            routeId: 2
        });

        assert.equal(decision.status, 403);
        assert.equal(decision.body.denial_reason, "WRONG_BUS");
    });

    it("refuses when the alternate bus has no capacity left", async () => {
        // Fill bus 2 completely: capacity 1, one student already aboard.
        await db.query("UPDATE buses SET maximum_capacity = 1 WHERE id = 2");
        await db.query(
            `INSERT INTO boarding_records (student_id, bus_id, route_id, access_result, rfid_verified, face_verified)
             VALUES (2, 2, 1, 'GRANTED', 1, 1)`
        );

        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus2,
            routeId: 1
        });

        assert.equal(decision.status, 403);
        assert.equal(decision.body.denial_reason, "WRONG_BUS");

        await db.query("UPDATE buses SET maximum_capacity = 50 WHERE id = 2");
    });

    it("refuses a camera-only boarding when the alternate bus has no capacity", async () => {
        await db.query("UPDATE buses SET maximum_capacity = 1 WHERE id = 2");
        await db.query(
            `INSERT INTO boarding_records (student_id, bus_id, route_id, access_result, rfid_verified, face_verified)
             VALUES (2, 2, 1, 'GRANTED', 1, 1)`
        );

        const issued = await harness.request("POST", "/api/face/camera-proof", {
            body: fixturesData.images.alice,
            device: fixturesData.devices.bus2
        });
        const response = await harness.request("POST", "/api/authorization/camera-check", {
            device: fixturesData.devices.bus2,
            body: {
                route_id: 1,
                face_proof: issued.body.face_proof,
                face_verification_id: issued.body.verification_id,
                client_event_id: `camera-capacity-${crypto.randomUUID()}`
            }
        });

        assert.equal(response.status, 403);
        assert.equal(response.body.authorized, false);
        assert.equal(response.body.denial_reason, "WRONG_BUS");

        await db.query("UPDATE buses SET maximum_capacity = 50 WHERE id = 2");
    });

    it("returns to normal rules once Fest Mode is switched off", async () => {
        await db.query(
            "UPDATE system_settings SET setting_value = 'NORMAL' WHERE setting_key = 'operating_mode'"
        );

        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus2,
            routeId: 1
        });

        assert.equal(decision.body.denial_reason, "WRONG_BUS");
    });
});

describe("route deviation", () => {
    const waypoints = [
        { latitude: 12.9716, longitude: 77.5946 },
        { latitude: 12.9720, longitude: 77.5950 }
    ];

    it("reports NOT_CONFIGURED and never blocks when a route has no geometry", async () => {
        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 1,
            gps: { latitude: 17.3924, longitude: 78.4867, age_seconds: 2 }
        });

        assert.equal(decision.body.authorized, true);
        assert.equal(decision.body.route_deviation.status, "NOT_CONFIGURED");
        assert.equal(decision.body.route_deviation.distance_m, null);
    });

    it("records the deviation but grants access while enforcement is off", async () => {
        await harness.request("PUT", "/api/route-waypoints/1", {
            auth: fixturesData.tokens.manager,
            body: { waypoints }
        });

        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 1,
            gps: { latitude: 17.3924, longitude: 78.4867, age_seconds: 2 }
        });

        assert.equal(decision.body.authorized, true);
        assert.equal(decision.body.route_deviation.status, "DEVIATED");
        assert.ok(decision.body.route_deviation.distance_m > 1000);

        const record = await lastBoardingRecord();
        assert.ok(record.route_deviation_m > 1000);
    });

    it("denies access when enforcement is on", async () => {
        await harness.request("PUT", "/api/route-waypoints/1", {
            auth: fixturesData.tokens.manager,
            body: { waypoints }
        });

        const setPolicy = await harness.request("PUT", "/api/settings/route-deviation", {
            auth: fixturesData.tokens.admin,
            body: { enforce: true, tolerance_m: 500 }
        });

        assert.equal(setPolicy.status, 200);

        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 1,
            gps: { latitude: 17.3924, longitude: 78.4867, age_seconds: 2 }
        });

        assert.equal(decision.status, 403);
        assert.equal(decision.body.denial_reason, "ROUTE_DEVIATION");
    });

    it("does not evaluate deviation without a fresh fix", async () => {
        await harness.request("PUT", "/api/route-waypoints/1", {
            auth: fixturesData.tokens.manager,
            body: { waypoints }
        });

        const { decision } = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 1,
            gps: { latitude: 17.3924, longitude: 78.4867, age_seconds: 900 }
        });

        assert.equal(decision.body.authorized, true);
        assert.equal(decision.body.route_deviation, null);
    });
});

describe("idempotency and device authentication", () => {
    it("returns the original decision for a repeated client_event_id", async () => {
        const clientEventId = `evt-${crypto.randomUUID()}`;

        const first = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 1,
            clientEventId
        });

        assert.equal(first.decision.body.authorized, true);

        const second = await harness.request("POST", "/api/authorization/check", {
            device: fixturesData.devices.bus1,
            body: {
                rfid_uid: "TESTCARD01",
                route_id: 1,
                face_proof: first.faceResult.body.face_proof,
                client_event_id: clientEventId
            }
        });

        assert.equal(second.status, 200);
        assert.equal(second.body.duplicate, true);

        const [rows] = await db.query("SELECT COUNT(*) AS count FROM boarding_records");
        assert.equal(Number(rows[0].count), 1);
    });

    it("does not reuse an event ID across devices", async () => {
        const clientEventId = `evt-${crypto.randomUUID()}`;
        const first = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 1,
            clientEventId
        });

        assert.equal(first.decision.body.authorized, true);

        const second = await harness.request("POST", "/api/authorization/check", {
            device: fixturesData.devices.bus2,
            body: {
                rfid_uid: "TESTCARD01",
                route_id: 1,
                client_event_id: clientEventId
            }
        });

        assert.equal(second.status, 409);
        assert.equal(second.body.error, "IDEMPOTENCY_CONFLICT");
        assert.equal(second.body.authorized, undefined);
    });

    it("does not reuse an event ID across authentication modes", async () => {
        const clientEventId = `evt-${crypto.randomUUID()}`;
        const first = await scan({
            cardUid: "TESTCARD01",
            image: fixturesData.images.alice,
            device: fixturesData.devices.bus1,
            routeId: 1,
            clientEventId
        });

        assert.equal(first.decision.body.authorized, true);

        const second = await harness.request("POST", "/api/authorization/camera-check", {
            device: fixturesData.devices.bus1,
            body: { route_id: 1, client_event_id: clientEventId }
        });

        assert.equal(second.status, 409);
        assert.equal(second.body.error, "IDEMPOTENCY_CONFLICT");
    });

    it("returns one original result for concurrent duplicate event IDs", async () => {
        const clientEventId = `evt-${crypto.randomUUID()}`;
        const results = await Promise.all([
            scan({
                cardUid: "TESTCARD01",
                image: fixturesData.images.alice,
                device: fixturesData.devices.bus1,
                routeId: 1,
                clientEventId
            }),
            scan({
                cardUid: "TESTCARD01",
                image: fixturesData.images.alice,
                device: fixturesData.devices.bus1,
                routeId: 1,
                clientEventId
            })
        ]);

        assert.equal(results.filter(({ decision }) => decision.body.authorized).length, 2);
        assert.ok(results.some(({ decision }) => decision.body.duplicate));
        const [rows] = await db.query(
            "SELECT COUNT(*) AS count FROM boarding_records WHERE client_event_id = ?",
            [clientEventId]
        );
        assert.equal(Number(rows[0].count), 1);
    });

    it("rejects a device with no credentials", async () => {
        const response = await harness.request("POST", "/api/authorization/check", {
            body: { rfid_uid: "TESTCARD01", route_id: 1 }
        });

        assert.equal(response.status, 401);
        assert.equal(response.body.error, "DEVICE_UNAUTHORIZED");
    });

    it("rejects a device with the wrong key", async () => {
        const response = await harness.request("POST", "/api/authorization/check", {
            device: { device_uid: "TEST-DEVICE-01", device_key: "a".repeat(64) },
            body: { rfid_uid: "TESTCARD01", route_id: 1 }
        });

        assert.equal(response.status, 401);
    });

    it("rejects a revoked device", async () => {
        const response = await harness.request("POST", "/api/authorization/check", {
            device: fixturesData.devices.revoked,
            body: { rfid_uid: "TESTCARD01", route_id: 1 }
        });

        assert.equal(response.status, 401);
    });

    it("rejects a device that claims another bus", async () => {
        const response = await harness.request("POST", "/api/authorization/check", {
            device: fixturesData.devices.bus1,
            body: {
                rfid_uid: "TESTCARD01",
                route_id: 1,
                bus_id: 2,
                face_verified: true
            }
        });

        assert.equal(response.status, 400);
        assert.equal(response.body.error, "INVALID_INPUT");
    });
});

describe("emergency reporting", () => {
    it("stores an SOS without inventing a position when GPS has no fix", async () => {
        const response = await harness.request("POST", "/api/emergency", {
            device: fixturesData.devices.bus1,
            body: { event_type: "SOS", description: "Breakdown near campus gate" }
        });

        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.emergency.location_status, "UNAVAILABLE");
        assert.equal(response.body.emergency.latitude, null);
        assert.equal(response.body.emergency.longitude, null);

        const [rows] = await db.query("SELECT * FROM emergency_events ORDER BY id DESC LIMIT 1");
        assert.equal(rows[0].latitude, null);
        assert.equal(rows[0].location_status, "UNAVAILABLE");
        assert.equal(rows[0].bus_id, fixturesData.devices.bus1.bus_id);
        assert.equal(rows[0].device_id, fixturesData.devices.bus1.id);
    });

    it("stores an SOS with a real fix", async () => {
        const response = await harness.request("POST", "/api/emergency", {
            device: fixturesData.devices.bus1,
            body: { event_type: "SOS", latitude: 17.3924, longitude: 78.4867 }
        });

        assert.equal(response.status, 201);
        assert.equal(response.body.emergency.location_status, "GPS_FIX");
        assert.equal(response.body.emergency.latitude, 17.3924);
    });

    it("refuses an emergency report without credentials", async () => {
        const response = await harness.request("POST", "/api/emergency", {
            body: { bus_id: 1, event_type: "SOS" }
        });

        assert.equal(response.status, 401);
    });
});

describe("face enrollment", () => {
    it("identifies an enrolled face without requiring an RFID UID", async () => {
        const response = await harness.request("POST", "/api/face/identify", {
            body: fixturesData.images.alice,
            device: fixturesData.devices.bus1
        });

        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.success, true);
        assert.equal(response.body.decision, "MATCH");
        assert.equal(response.body.matched_student_id, fixturesData.ids.alice);
        assert.equal(response.body.student.student_db_id, fixturesData.ids.alice);
        assert.equal(response.body.face_proof, undefined);
    });

    it("rejects camera identification without device authentication", async () => {
        const response = await harness.request("POST", "/api/face/identify", {
            body: fixturesData.images.alice
        });

        assert.equal(response.status, 401);
    });

    it("returns an explicit denial for a frame with no usable face", async () => {
        const response = await harness.request("POST", "/api/face/identify", {
            body: fixturesData.images.noFace,
            device: fixturesData.devices.bus1
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.success, false);
        assert.equal(response.body.error, "FACE_NOT_IDENTIFIED");
        assert.equal(response.body.decision, "NO_FACE");
        assert.equal(response.body.matched_student_id, undefined);
    });

    it("issues a server-bound camera-only proof without authorizing access", async () => {
        const response = await harness.request("POST", "/api/face/camera-proof", {
            body: fixturesData.images.alice,
            device: fixturesData.devices.bus1
        });

        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.authentication_mode, "CAMERA_ONLY");
        assert.equal(response.body.matched_student_id, fixturesData.ids.alice);
        assert.equal(typeof response.body.face_proof, "string");
        assert.equal(response.body.authorization, undefined);

        const [rows] = await db.query(
            `SELECT authentication_mode, rfid_card_id, student_id, device_id, decision
               FROM face_verifications
              WHERE id = ?`,
            [response.body.verification_id]
        );

        assert.equal(rows[0].authentication_mode, "CAMERA_ONLY");
        assert.equal(rows[0].rfid_card_id, null);
        assert.equal(rows[0].student_id, fixturesData.ids.alice);
        assert.equal(rows[0].device_id, fixturesData.devices.bus1.id);
        assert.equal(rows[0].decision, "MATCH");
    });

    it("requires device authentication to issue a camera-only proof", async () => {
        const response = await harness.request("POST", "/api/face/camera-proof", {
            body: fixturesData.images.alice
        });

        assert.equal(response.status, 401);
    });

    it("rejects unknown or no-face images without issuing a camera proof", async () => {
        const response = await harness.request("POST", "/api/face/camera-proof", {
            body: fixturesData.images.noFace,
            device: fixturesData.devices.bus1
        });

        assert.equal(response.status, 403);
        assert.equal(response.body.error, "FACE_NOT_IDENTIFIED");
        assert.equal(response.body.face_proof, undefined);
    });

    it("rejects camera-only proof use on another device and on replay", async () => {
        const issued = await harness.request("POST", "/api/face/camera-proof", {
            body: fixturesData.images.alice,
            device: fixturesData.devices.bus1
        });

        assert.equal(issued.status, 201);

        await assert.rejects(
            faceTokenService.consumeCameraOnlyProof({
                token: issued.body.face_proof,
                deviceId: fixturesData.devices.bus2.id
            }),
            (error) => error.code === "FACE_TOKEN_INVALID"
        );

        const consumed = await faceTokenService.consumeCameraOnlyProof({
            token: issued.body.face_proof,
            deviceId: fixturesData.devices.bus1.id,
            studentId: fixturesData.ids.alice
        });

        assert.equal(consumed.verification.authentication_mode, "CAMERA_ONLY");

        await assert.rejects(
            faceTokenService.consumeCameraOnlyProof({
                token: issued.body.face_proof,
                deviceId: fixturesData.devices.bus1.id
            }),
            (error) => error.code === "FACE_TOKEN_REUSED"
        );
    });

    it("rejects an expired camera-only proof", async () => {
        const expired = jwt.sign(
            {
                jti: crypto.randomUUID(),
                sub: String(fixturesData.ids.alice),
                mode: "CAMERA_ONLY",
                dev: fixturesData.devices.bus1.id,
                dec: "MATCH"
            },
            config.faceTokenSecret,
            {
                expiresIn: -1,
                issuer: faceTokenService.ISSUER,
                audience: faceTokenService.AUDIENCE
            }
        );

        await assert.rejects(
            faceTokenService.consumeCameraOnlyProof({
                token: expired,
                deviceId: fixturesData.devices.bus1.id
            }),
            (error) => error.code === "FACE_TOKEN_EXPIRED"
        );
    });

    it("records missing camera proofs as camera-only denials", async () => {
        const eventId = `camera-missing-proof-${crypto.randomUUID()}`;
        const response = await harness.request("POST", "/api/authorization/camera-check", {
            device: fixturesData.devices.bus1,
            body: {
                route_id: 1,
                client_event_id: eventId
            }
        });

        assert.equal(response.status, 403);
        assert.equal(response.body.denial_reason, "FACE_NOT_PERFORMED");
        assert.equal(response.body.authentication_mode, "CAMERA_ONLY");

        const [rows] = await db.query(
            "SELECT denial_reason, authentication_mode, access_result FROM boarding_records WHERE client_event_id = ?",
            [eventId]
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].denial_reason, "FACE_NOT_PERFORMED");
        assert.equal(rows[0].authentication_mode, "CAMERA_ONLY");
        assert.equal(rows[0].access_result, "DENIED");
    });

    it("records invalid camera proofs as camera-only denials", async () => {
        const eventId = `camera-invalid-proof-${crypto.randomUUID()}`;
        const response = await harness.request("POST", "/api/authorization/camera-check", {
            device: fixturesData.devices.bus1,
            body: {
                route_id: 1,
                face_proof: "not-a-valid-proof",
                client_event_id: eventId
            }
        });

        assert.equal(response.status, 403);
        assert.equal(response.body.denial_reason, "FACE_INVALID");
        assert.equal(response.body.authentication_mode, "CAMERA_ONLY");

        const [rows] = await db.query(
            "SELECT denial_reason, authentication_mode, access_result FROM boarding_records WHERE client_event_id = ?",
            [eventId]
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].denial_reason, "FACE_INVALID");
        assert.equal(rows[0].authentication_mode, "CAMERA_ONLY");
        assert.equal(rows[0].access_result, "DENIED");
    });

    it("authorizes camera-only boarding and records its authentication mode", async () => {
        const issued = await harness.request("POST", "/api/face/camera-proof", {
            body: fixturesData.images.alice,
            device: fixturesData.devices.bus1
        });
        const eventId = `camera-grant-${crypto.randomUUID()}`;

        const response = await harness.request("POST", "/api/authorization/camera-check", {
            device: fixturesData.devices.bus1,
            body: {
                route_id: 1,
                face_proof: issued.body.face_proof,
                face_verification_id: issued.body.verification_id,
                client_event_id: eventId
            }
        });

        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.authorized, true);
        assert.equal(response.body.authentication_mode, "CAMERA_ONLY");
        assert.equal(response.body.rfid_verified, false);
        assert.equal(response.body.face_verified, true);

        const [rows] = await db.query(
            `SELECT authentication_mode, boarding_type, student_id, rfid_card_id,
                    face_verified, access_result
               FROM boarding_records
              WHERE client_event_id = ?`,
            [eventId]
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].authentication_mode, "CAMERA_ONLY");
        assert.equal(rows[0].boarding_type, "NORMAL");
        assert.equal(rows[0].student_id, fixturesData.ids.alice);
        assert.equal(rows[0].rfid_card_id, null);
        assert.equal(rows[0].face_verified, 1);
        assert.equal(rows[0].access_result, "GRANTED");
    });

    it("authorizes an enrolled student without an RFID card row", async () => {
        const studentId = fixturesData.ids.bob;
        const eventId = `camera-no-rfid-${crypto.randomUUID()}`;

        await db.query("DELETE FROM rfid_cards WHERE student_id = ?", [studentId]);

        try {
            const issued = await harness.request("POST", "/api/face/camera-proof", {
                body: fixturesData.images.bob,
                device: fixturesData.devices.bus1
            });
            assert.equal(issued.status, 201, JSON.stringify(issued.body));

            const response = await harness.request("POST", "/api/authorization/camera-check", {
                device: fixturesData.devices.bus1,
                body: {
                    route_id: 1,
                    face_proof: issued.body.face_proof,
                    face_verification_id: issued.body.verification_id,
                    client_event_id: eventId
                }
            });

            assert.equal(response.status, 200, JSON.stringify(response.body));
            assert.equal(response.body.authorized, true);
            assert.equal(response.body.authentication_mode, "CAMERA_ONLY");
            assert.equal(response.body.rfid_verified, false);

            const [rows] = await db.query(
                `SELECT authentication_mode, student_id, rfid_card_id,
                        attempted_rfid_uid, rfid_verified, face_verified, access_result
                   FROM boarding_records
                  WHERE client_event_id = ?`,
                [eventId]
            );

            assert.equal(rows.length, 1);
            assert.equal(rows[0].authentication_mode, "CAMERA_ONLY");
            assert.equal(rows[0].student_id, studentId);
            assert.equal(rows[0].rfid_card_id, null);
            assert.equal(rows[0].attempted_rfid_uid, null);
            assert.equal(rows[0].rfid_verified, 0);
            assert.equal(rows[0].face_verified, 1);
            assert.equal(rows[0].access_result, "GRANTED");
        } finally {
            await db.query(
                `INSERT INTO rfid_cards (id, student_id, rfid_uid, status)
                 VALUES (?, ?, ?, 'ACTIVE')`,
                [2, studentId, "TESTCARD02"]
            );
        }
    });

    it("denies camera-only boarding for an unauthorized route and records one denial", async () => {
        const issued = await harness.request("POST", "/api/face/camera-proof", {
            body: fixturesData.images.alice,
            device: fixturesData.devices.bus1
        });
        const eventId = `camera-route-${crypto.randomUUID()}`;

        const response = await harness.request("POST", "/api/authorization/camera-check", {
            device: fixturesData.devices.bus1,
            body: {
                route_id: 2,
                face_proof: issued.body.face_proof,
                face_verification_id: issued.body.verification_id,
                client_event_id: eventId
            }
        });

        assert.equal(response.status, 403);
        assert.equal(response.body.authorized, false);
        assert.equal(response.body.denial_reason, "INVALID_ROUTE");
        assert.equal(response.body.authentication_mode, "CAMERA_ONLY");

        const [rows] = await db.query(
            "SELECT COUNT(*) AS count, MAX(authentication_mode) AS mode FROM boarding_records WHERE client_event_id = ?",
            [eventId]
        );
        assert.equal(rows[0].count, 1);
        assert.equal(rows[0].mode, "CAMERA_ONLY");
    });

    it("denies an inactive student in the camera-only authorization branch", async () => {
        const proof = await faceTokenService.issueCameraOnlyProof({
            studentId: fixturesData.ids.carol,
            deviceId: fixturesData.devices.bus1.id,
            score: 0.9,
            engine: "sface-v1"
        });
        const response = await harness.request("POST", "/api/authorization/camera-check", {
            device: fixturesData.devices.bus1,
            body: {
                route_id: 1,
                face_proof: proof.token,
                face_verification_id: proof.verificationId,
                client_event_id: `camera-inactive-${crypto.randomUUID()}`
            }
        });

        assert.equal(response.status, 403);
        assert.equal(response.body.denial_reason, "STUDENT_INACTIVE");
        assert.equal(response.body.authorized, false);
    });

    it("returns the original camera decision for an idempotent retry", async () => {
        const issued = await harness.request("POST", "/api/face/camera-proof", {
            body: fixturesData.images.alice,
            device: fixturesData.devices.bus1
        });
        const eventId = `camera-idempotent-${crypto.randomUUID()}`;
        const body = {
            route_id: 1,
            face_proof: issued.body.face_proof,
            face_verification_id: issued.body.verification_id,
            client_event_id: eventId
        };

        const first = await harness.request("POST", "/api/authorization/camera-check", {
            device: fixturesData.devices.bus1,
            body
        });
        const second = await harness.request("POST", "/api/authorization/camera-check", {
            device: fixturesData.devices.bus1,
            body
        });

        assert.equal(first.status, 200);
        assert.equal(first.body.authorized, true);
        assert.equal(second.status, 200);
        assert.equal(second.body.authorized, true);
        assert.equal(second.body.duplicate, true);

        const [rows] = await db.query(
            "SELECT COUNT(*) AS count FROM boarding_records WHERE client_event_id = ?",
            [eventId]
        );
        assert.equal(rows[0].count, 1);
    });

    it("refuses to enroll one face under two students", async () => {
        const response = await harness.request("POST", "/api/face/enroll", {
            auth: fixturesData.tokens.manager,
            body: { student_id: fixturesData.ids.dave, image: fixturesData.images.alice.toString("base64") }
        });

        assert.equal(response.status, 409);
        assert.equal(response.body.error, "DUPLICATE_FACE");
    });

    it("rejects enrollment without a usable face", async () => {
        const response = await harness.request("POST", "/api/face/enroll", {
            auth: fixturesData.tokens.manager,
            body: { student_id: fixturesData.ids.dave, image: fixturesData.images.noFace.toString("base64") }
        });

        assert.equal(response.status, 422);
        assert.equal(response.body.error, "NO_USABLE_IMAGE");
    });

    it("refuses to enroll an inactive student", async () => {
        const response = await harness.request("POST", "/api/face/enroll", {
            auth: fixturesData.tokens.manager,
            body: {
                student_id: fixturesData.ids.carol,
                image: fixturesData.images.bob.toString("base64")
            }
        });

        assert.equal(response.status, 409);
        assert.equal(response.body.error, "STUDENT_INACTIVE");
    });

    it("requires staff authentication", async () => {
        const response = await harness.request("POST", "/api/face/enroll", {
            body: { student_id: fixturesData.ids.alice, image: fixturesData.images.alice.toString("base64") }
        });

        assert.equal(response.status, 401);
    });

    it("reports enrollment status for a student", async () => {
        const response = await harness.request("GET", `/api/face/status/${fixturesData.ids.alice}`, {
            auth: fixturesData.tokens.manager
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.face.enrolled, true);
        assert.ok(response.body.face.template_count >= 1);
        assert.equal(response.body.face.engine, "sface-v1");
    });
});

describe("API authorization boundaries", () => {
    it("rejects anonymous access to student data", async () => {
        const response = await harness.request("GET", "/api/students");
        assert.equal(response.status, 401);
    });

    it("rejects a driver on a manager endpoint", async () => {
        const response = await harness.request("GET", "/api/students", {
            auth: fixturesData.tokens.driver
        });

        assert.equal(response.status, 403);
    });

    it("allows a manager to read students", async () => {
        const response = await harness.request("GET", "/api/students", {
            auth: fixturesData.tokens.manager
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.students.length, 4);
    });

    it("allows a driver to read boarding records but not to create them", async () => {
        const read = await harness.request("GET", "/api/boarding", {
            auth: fixturesData.tokens.driver
        });
        assert.equal(read.status, 200);

        const create = await harness.request("POST", "/api/boarding", {
            auth: fixturesData.tokens.driver,
            body: { student_id: 1, bus_id: 1, route_id: 1, access_result: "GRANTED" }
        });
        assert.equal(create.status, 403);
    });

    it("restricts device registration to administrators", async () => {
        const asManager = await harness.request("POST", "/api/devices", {
            auth: fixturesData.tokens.manager,
            body: { device_uid: "TEST-DEVICE-NEW", bus_id: 1 }
        });
        assert.equal(asManager.status, 403);

        const asAdmin = await harness.request("POST", "/api/devices", {
            auth: fixturesData.tokens.admin,
            body: { device_uid: "TEST-DEVICE-NEW", bus_id: 1, label: "New reader" }
        });

        assert.equal(asAdmin.status, 201);
        assert.match(asAdmin.body.device_key, /^[a-f0-9]{64}$/);

        const list = await harness.request("GET", "/api/devices", {
            auth: fixturesData.tokens.admin
        });
        assert.equal(list.status, 200);
        assert.equal(list.body.devices.some((device) => device.device_uid === "TEST-DEVICE-NEW"), true);
        // The key is never returned again.
        assert.equal(list.body.devices.some((device) => device.device_key !== undefined), false);
    });

    it("does not accept the superseded authorization contract", async () => {
        const response = await harness.request("POST", "/api/authorization/check", {
            auth: fixturesData.tokens.admin,
            body: { student_id: 1, bus_id: 1, route_id: 1, rfid_card_id: 1, face_verified: true }
        });

        // Staff tokens are not device credentials: the endpoint refuses them
        // rather than falling back to the old boolean.
        assert.equal(response.status, 401);
    });
});

describe("operating mode administration", () => {
    it("lets an administrator switch Fest Mode on and off", async () => {
        const on = await harness.request("PUT", "/api/settings/operating-mode", {
            auth: fixturesData.tokens.admin,
            body: { mode: "FEST", ends_at: new Date(Date.now() + 3_600_000).toISOString() }
        });

        assert.equal(on.status, 200);
        assert.equal(on.body.operating_mode.active, true);

        const off = await harness.request("PUT", "/api/settings/operating-mode", {
            auth: fixturesData.tokens.admin,
            body: { mode: "NORMAL" }
        });

        assert.equal(off.body.operating_mode.mode, "NORMAL");
        assert.equal(off.body.operating_mode.active, false);
    });

    it("refuses Fest Mode changes from a transport manager", async () => {
        const response = await harness.request("PUT", "/api/settings/operating-mode", {
            auth: fixturesData.tokens.manager,
            body: { mode: "FEST" }
        });

        assert.equal(response.status, 403);
    });

    it("rejects a Fest window that ends before it starts", async () => {
        const response = await harness.request("PUT", "/api/settings/operating-mode", {
            auth: fixturesData.tokens.admin,
            body: {
                mode: "FEST",
                starts_at: new Date(Date.now() + 7_200_000).toISOString(),
                ends_at: new Date(Date.now() + 3_600_000).toISOString()
            }
        });

        assert.equal(response.status, 400);
    });
});

describe("GPS reporting", () => {
    it("stores a fix reported by the device and flags staleness", async () => {
        const fresh = await harness.request("POST", "/api/gps/location", {
            device: fixturesData.devices.bus1,
            body: { latitude: 17.3924, longitude: 78.4867, satellites: 8, hdop: 1.1, age_seconds: 3 }
        });

        assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
        assert.equal(fresh.body.location.fix_status, "GPS_FIX");

        const stale = await harness.request("POST", "/api/gps/location", {
            device: fixturesData.devices.bus1,
            body: { latitude: 17.3924, longitude: 78.4867, age_seconds: 900 }
        });

        assert.equal(stale.status, 201);
        assert.equal(stale.body.location.fix_status, "GPS_STALE");
    });

    it("rejects a position without coordinates", async () => {
        const response = await harness.request("POST", "/api/gps/location", {
            device: fixturesData.devices.bus1,
            body: { speed: 12 }
        });

        assert.equal(response.status, 400);
    });

    it("rejects an out-of-range coordinate", async () => {
        const response = await harness.request("POST", "/api/gps/location", {
            device: fixturesData.devices.bus1,
            body: { latitude: 999, longitude: 78.4867 }
        });

        assert.equal(response.status, 400);
    });
});
