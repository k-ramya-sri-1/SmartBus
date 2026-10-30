-- ============================================================
-- SMARTBUS MIGRATION 001 - ACCESS CONTROL HARDENING
-- ============================================================
-- Purpose:
--   Adds the tables and columns required by the real (non-simulated)
--   access-control pipeline:
--     * device authentication            -> devices
--     * single-use face verification     -> face_verifications
--     * operating modes (Fest Mode)      -> system_settings
--     * route deviation detection        -> route_waypoints
--     * GPS fix / staleness metadata     -> gps_locations, emergency_events
--     * auditable access decisions       -> boarding_records
--
-- Safety:
--   This migration is ADDITIVE and NON-DESTRUCTIVE.
--   It never drops a table, a column or a row, and it never rewrites
--   existing values. Existing enum values are preserved verbatim.
--
--   Run it with:  node database/migrate.js
--   (do not run database/schema.sql against a database that holds data)
-- ============================================================


-- ============================================================
-- 1. DEVICES
-- One row per ESP32 access-control unit. The API key is stored as
-- a SHA-256 hash, never in plaintext.
-- ============================================================

CREATE TABLE IF NOT EXISTS devices (
    id INT AUTO_INCREMENT PRIMARY KEY,

    device_uid VARCHAR(64) NOT NULL UNIQUE,

    bus_id INT NOT NULL,

    api_key_hash CHAR(64) NOT NULL,

    label VARCHAR(120) NULL,

    status ENUM('ACTIVE', 'INACTIVE', 'REVOKED')
        NOT NULL DEFAULT 'ACTIVE',

    firmware_version VARCHAR(40) NULL,

    last_seen_at TIMESTAMP NULL,

    created_by_user_id INT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_device_bus
        FOREIGN KEY (bus_id)
        REFERENCES buses(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_device_user
        FOREIGN KEY (created_by_user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    INDEX idx_device_bus (bus_id),
    INDEX idx_device_status (status)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 2. FACE VERIFICATIONS
-- One row per issued face-verification token.
-- The device can never assert "face_verified = true" on its own:
-- the authorization endpoint accepts only a token recorded here,
-- bound to one student, one RFID card, one device, and one use.
-- ============================================================

CREATE TABLE IF NOT EXISTS face_verifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,

    token_id CHAR(36) NOT NULL UNIQUE,

    student_id INT NOT NULL,
    rfid_card_id INT NOT NULL,
    device_id INT NOT NULL,

    -- Identity the face actually matched (may differ from student_id)
    matched_student_id INT NULL,

    -- SFace cosine similarity in [-1, 1]
    score DECIMAL(6,5) NULL,

    decision ENUM(
        'MATCH',
        'NO_FACE',
        'MULTIPLE_FACES',
        'LOW_SCORE',
        'DIFFERENT_STUDENT',
        'ENGINE_UNAVAILABLE',
        'ENGINE_ERROR'
    ) NOT NULL,

    engine VARCHAR(40) NULL,

    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_facever_student
        FOREIGN KEY (student_id)
        REFERENCES students(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_facever_card
        FOREIGN KEY (rfid_card_id)
        REFERENCES rfid_cards(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_facever_device
        FOREIGN KEY (device_id)
        REFERENCES devices(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_facever_matched
        FOREIGN KEY (matched_student_id)
        REFERENCES students(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    INDEX idx_facever_student (student_id, created_at),
    INDEX idx_facever_expiry (expires_at),
    INDEX idx_facever_device (device_id, created_at)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 3. SYSTEM SETTINGS
-- Small key/value store for operating mode (NORMAL / FEST) and
-- the route-deviation policy. Keeps Fest Mode configurable without
-- redesigning the schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(64) PRIMARY KEY,

    setting_value VARCHAR(255) NOT NULL,

    description VARCHAR(255) NULL,

    updated_by_user_id INT NULL,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_setting_user
        FOREIGN KEY (updated_by_user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 4. ROUTE WAYPOINTS
-- Ordered polyline used for route-deviation detection.
-- When a route has no waypoints the system reports the deviation
-- check as NOT_EVALUATED instead of inventing a verdict.
-- ============================================================

CREATE TABLE IF NOT EXISTS route_waypoints (
    id INT AUTO_INCREMENT PRIMARY KEY,

    route_id INT NOT NULL,

    sequence_no INT NOT NULL,

    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,

    label VARCHAR(120) NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_waypoint_route
        FOREIGN KEY (route_id)
        REFERENCES routes(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    UNIQUE KEY uq_waypoint_sequence (route_id, sequence_no)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 5. BUS ROUTES
-- Records which routes a bus is allowed to serve.
-- This table already existed in the live database but was missing
-- from schema.sql, which is why the rescue engine referenced a table
-- the bootstrap script did not create. Declared here so both agree.
-- ============================================================

CREATE TABLE IF NOT EXISTS bus_routes (
    id INT AUTO_INCREMENT PRIMARY KEY,

    bus_id INT NOT NULL,
    route_id INT NOT NULL,

    status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_bus_routes_bus
        FOREIGN KEY (bus_id)
        REFERENCES buses(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_bus_routes_route
        FOREIGN KEY (route_id)
        REFERENCES routes(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    UNIQUE KEY uq_bus_route (bus_id, route_id)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 6. BOARDING RECORDS
-- Adds the evidence behind every decision. Enum values are extended,
-- never removed, so historic rows keep their meaning.
-- ============================================================

ALTER TABLE boarding_records
    MODIFY denial_reason ENUM(
        'INVALID_RFID',
        'FACE_MISMATCH',
        'WRONG_BUS',
        'INVALID_ROUTE',
        'STUDENT_INACTIVE',
        'NO_AUTHORIZATION',
        'OTHER',
        'FACE_UNAVAILABLE',
        'FACE_TIMEOUT',
        'FACE_INVALID',
        'FACE_NOT_PERFORMED',
        'DEVICE_UNAUTHORIZED',
        'ROUTE_DEVIATION',
        'SYSTEM_ERROR'
    ) NULL,

    MODIFY boarding_type ENUM(
        'NORMAL',
        'RESCUE',
        'FEST'
    ) NOT NULL DEFAULT 'NORMAL',

    ADD COLUMN device_id INT NULL AFTER route_id,

    ADD COLUMN face_verification_id BIGINT NULL AFTER temporary_authorization_id,

    ADD COLUMN face_score DECIMAL(6,5) NULL AFTER face_verified,

    ADD COLUMN gps_status ENUM(
        'GPS_FIX',
        'GPS_STALE',
        'UNAVAILABLE'
    ) NULL AFTER face_score,

    ADD COLUMN route_deviation_m DECIMAL(10,1) NULL AFTER gps_status,

    ADD COLUMN client_event_id VARCHAR(80) NULL AFTER boarded_at,

    ADD CONSTRAINT fk_boarding_device
        FOREIGN KEY (device_id)
        REFERENCES devices(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    ADD CONSTRAINT fk_boarding_facever
        FOREIGN KEY (face_verification_id)
        REFERENCES face_verifications(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    ADD UNIQUE KEY uq_boarding_client_event (client_event_id);


-- ============================================================
-- 7. GPS LOCATIONS
-- Fix quality and the source timestamp reported by the module, so a
-- stale or absent fix can never be mistaken for a valid position.
-- ============================================================

ALTER TABLE gps_locations
    ADD COLUMN fix_status ENUM(
        'GPS_FIX',
        'GPS_STALE',
        'UNAVAILABLE'
    ) NOT NULL DEFAULT 'GPS_FIX' AFTER speed,

    ADD COLUMN satellites TINYINT UNSIGNED NULL AFTER fix_status,

    ADD COLUMN hdop DECIMAL(5,2) NULL AFTER satellites,

    ADD COLUMN source_time DATETIME NULL AFTER hdop,

    ADD COLUMN route_deviation_m DECIMAL(10,1) NULL AFTER source_time,

    ADD COLUMN device_id INT NULL AFTER route_deviation_m,

    ADD CONSTRAINT fk_gps_device
        FOREIGN KEY (device_id)
        REFERENCES devices(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    ADD INDEX idx_gps_fix_status (fix_status);


-- ============================================================
-- 8. EMERGENCY EVENTS
-- An SOS raised indoors has no fix. Recording that honestly is better
-- than storing (0,0) or refusing the emergency, so the coordinates
-- become nullable and carry an explicit location_status.
-- ============================================================

ALTER TABLE emergency_events
    MODIFY latitude DECIMAL(10,7) NULL,

    MODIFY longitude DECIMAL(10,7) NULL,

    ADD COLUMN location_status ENUM(
        'GPS_FIX',
        'GPS_STALE',
        'UNAVAILABLE'
    ) NOT NULL DEFAULT 'UNAVAILABLE' AFTER longitude,

    ADD COLUMN device_id INT NULL AFTER reported_by_user_id,

    ADD CONSTRAINT fk_emergency_device
        FOREIGN KEY (device_id)
        REFERENCES devices(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL;


-- ============================================================
-- 9. FACE PROFILES
-- face_profiles stops being a placeholder: it records which engine
-- enrolled the student and how many templates exist. The templates
-- themselves are 128-D embeddings held by the face service; no raw
-- face image is stored anywhere.
-- ============================================================

ALTER TABLE face_profiles
    ADD COLUMN engine VARCHAR(40) NULL AFTER profile_reference,

    ADD COLUMN template_count INT NOT NULL DEFAULT 0 AFTER engine,

    ADD COLUMN enrolled_by_user_id INT NULL AFTER template_count,

    ADD COLUMN last_enrolled_at TIMESTAMP NULL AFTER enrolled_by_user_id,

    ADD CONSTRAINT fk_face_enroller
        FOREIGN KEY (enrolled_by_user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL;


-- ============================================================
-- 10. DEFAULT OPERATING MODE
-- ============================================================

INSERT INTO system_settings (setting_key, setting_value, description)
VALUES
    ('operating_mode', 'NORMAL',
     'NORMAL or FEST. Fest Mode follows report section 4.14.'),
    ('fest_starts_at', '',
     'ISO timestamp; empty means "no scheduled window".'),
    ('fest_ends_at', '',
     'ISO timestamp; empty means "no scheduled window".'),
    ('route_deviation_enforce', 'false',
     'true = deny access when the bus is off its configured route.'),
    ('route_deviation_tolerance_m', '1500',
     'Distance from the route polyline before a deviation is reported.'),
    ('gps_max_fix_age_seconds', '120',
     'A fix older than this is reported as GPS_STALE, never as valid.')
ON DUPLICATE KEY UPDATE
    description = VALUES(description);
