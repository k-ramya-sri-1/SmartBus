CREATE DATABASE smartbus;
USE smartbus;
SELECT DATABASE();
USE smartbus;

-- ============================================================
-- SMARTBUS RESCUE AND ACCESS MANAGEMENT SYSTEM
-- DATABASE SCHEMA
-- ============================================================

-- ============================================================
-- STEP 1: REMOVE OLD SMARTBUS TABLES IF THEY EXIST
-- This affects ONLY these SmartBus tables.
-- It does NOT delete the smartbus database.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS boarding_records;
DROP TABLE IF EXISTS temporary_authorizations;
DROP TABLE IF EXISTS rescue_allocations;
DROP TABLE IF EXISTS emergency_events;
DROP TABLE IF EXISTS gps_locations;
DROP TABLE IF EXISTS bus_assignments;
DROP TABLE IF EXISTS face_profiles;
DROP TABLE IF EXISTS rfid_cards;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS routes;
DROP TABLE IF EXISTS buses;
DROP TABLE IF EXISTS students;

SET FOREIGN_KEY_CHECKS = 1;


-- ============================================================
-- 1. STUDENTS
-- Stores basic student information.
-- RFID, face profile and bus assignment are stored separately.
-- ============================================================

CREATE TABLE students (
    id INT AUTO_INCREMENT PRIMARY KEY,

    student_id VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE,
    phone VARCHAR(20),

    status ENUM('ACTIVE', 'INACTIVE')
        NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 2. RFID CARDS
-- Stores RFID cards linked to students.
-- ============================================================

CREATE TABLE rfid_cards (
    id INT AUTO_INCREMENT PRIMARY KEY,

    student_id INT NOT NULL,
    rfid_uid VARCHAR(100) NOT NULL UNIQUE,

    status ENUM('ACTIVE', 'INACTIVE', 'LOST', 'BLOCKED')
        NOT NULL DEFAULT 'ACTIVE',

    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_verified_at TIMESTAMP NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_rfid_student
        FOREIGN KEY (student_id)
        REFERENCES students(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    INDEX idx_rfid_student (student_id)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 3. FACE PROFILES
-- Stores a reference to a student's facial profile.
-- Raw face images are NOT stored in this table.
-- ============================================================

CREATE TABLE face_profiles (
    id INT AUTO_INCREMENT PRIMARY KEY,

    student_id INT NOT NULL UNIQUE,

    profile_reference VARCHAR(255) NOT NULL,

    verification_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_face_student
        FOREIGN KEY (student_id)
        REFERENCES students(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 4. BUSES
-- Stores bus information and maximum operational capacity.
-- Current passengers are NOT stored as a manually trusted value.
-- ============================================================

CREATE TABLE buses (
    id INT AUTO_INCREMENT PRIMARY KEY,

    bus_number VARCHAR(30) NOT NULL UNIQUE,
    registration_number VARCHAR(30) UNIQUE,

    maximum_capacity INT NOT NULL,

    status ENUM('ACTIVE', 'INACTIVE', 'MAINTENANCE')
        NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT chk_bus_capacity
        CHECK (maximum_capacity > 0)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 5. ROUTES
-- Stores bus route information.
-- ============================================================

CREATE TABLE routes (
    id INT AUTO_INCREMENT PRIMARY KEY,

    route_name VARCHAR(100) NOT NULL,

    starting_point VARCHAR(150) NOT NULL,
    destination VARCHAR(150) NOT NULL,

    description TEXT,

    status ENUM('ACTIVE', 'INACTIVE')
        NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 6. BUS ASSIGNMENTS
-- Stores the student's PERMANENT bus and route assignment.
--
-- IMPORTANT:
-- Rescue situations must NOT overwrite this assignment.
-- ============================================================

CREATE TABLE bus_assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,

    student_id INT NOT NULL,
    bus_id INT NOT NULL,
    route_id INT NOT NULL,

    assignment_status ENUM('ACTIVE', 'INACTIVE', 'EXPIRED')
        NOT NULL DEFAULT 'ACTIVE',

    valid_from DATE NOT NULL,
    valid_to DATE NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_assignment_student
        FOREIGN KEY (student_id)
        REFERENCES students(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_assignment_bus
        FOREIGN KEY (bus_id)
        REFERENCES buses(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_assignment_route
        FOREIGN KEY (route_id)
        REFERENCES routes(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    INDEX idx_assignment_student (student_id),
    INDEX idx_assignment_bus (bus_id),
    INDEX idx_assignment_route (route_id),
    INDEX idx_assignment_status (assignment_status)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 7. USERS
-- Stores system users such as Admin, Transport Manager,
-- Driver and Conductor.
-- ============================================================

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,

    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(150) UNIQUE NOT NULL,

    password_hash VARCHAR(255) NOT NULL,

    role ENUM(
        'ADMIN',
        'TRANSPORT_MANAGER',
        'DRIVER',
        'CONDUCTOR'
    ) NOT NULL,

    status ENUM('ACTIVE', 'INACTIVE')
        NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 8. GPS LOCATIONS
-- Stores historical GPS positions of buses.
-- ============================================================

CREATE TABLE gps_locations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,

    bus_id INT NOT NULL,

    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,

    speed DECIMAL(6,2) NULL,

    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_gps_bus
        FOREIGN KEY (bus_id)
        REFERENCES buses(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    INDEX idx_gps_bus_time (bus_id, recorded_at)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 9. EMERGENCY EVENTS
-- Stores SOS / breakdown / emergency events.
-- ============================================================

CREATE TABLE emergency_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,

    bus_id INT NOT NULL,

    reported_by_user_id INT NULL,

    event_type ENUM(
        'SOS',
        'BREAKDOWN',
        'ACCIDENT',
        'OTHER'
    ) NOT NULL,

    description TEXT,

    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,

    status ENUM(
        'OPEN',
        'IN_PROGRESS',
        'RESOLVED',
        'CANCELLED'
    ) NOT NULL DEFAULT 'OPEN',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    resolved_at TIMESTAMP NULL,

    CONSTRAINT fk_emergency_bus
        FOREIGN KEY (bus_id)
        REFERENCES buses(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_emergency_user
        FOREIGN KEY (reported_by_user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    INDEX idx_emergency_bus (bus_id),
    INDEX idx_emergency_status (status)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 10. RESCUE ALLOCATIONS
-- Stores which affected student is allocated to which
-- rescue bus during an emergency.
--
-- Permanent bus assignment remains unchanged.
-- ============================================================

CREATE TABLE rescue_allocations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,

    emergency_event_id BIGINT NOT NULL,

    student_id INT NOT NULL,

    rescue_bus_id INT NOT NULL,

    allocation_status ENUM(
        'ALLOCATED',
        'BOARDED',
        'COMPLETED',
        'CANCELLED'
    ) NOT NULL DEFAULT 'ALLOCATED',

    allocated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    completed_at TIMESTAMP NULL,

    CONSTRAINT fk_rescue_emergency
        FOREIGN KEY (emergency_event_id)
        REFERENCES emergency_events(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_rescue_student
        FOREIGN KEY (student_id)
        REFERENCES students(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_rescue_bus
        FOREIGN KEY (rescue_bus_id)
        REFERENCES buses(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    INDEX idx_rescue_emergency (emergency_event_id),
    INDEX idx_rescue_student (student_id),
    INDEX idx_rescue_bus (rescue_bus_id),
    INDEX idx_rescue_status (allocation_status)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 11. TEMPORARY AUTHORIZATIONS
-- Provides temporary permission for an alternate/rescue bus.
--
-- The student's permanent bus assignment is NOT changed.
-- ============================================================

CREATE TABLE temporary_authorizations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,

    rescue_allocation_id BIGINT NULL,

    student_id INT NOT NULL,

    temporary_bus_id INT NOT NULL,

    route_id INT NULL,

    authorization_type ENUM(
        'EMERGENCY_RESCUE',
        'MISSED_BUS',
        'OTHER'
    ) NOT NULL,

    purpose VARCHAR(255),

    status ENUM(
        'ACTIVE',
        'USED',
        'EXPIRED',
        'CANCELLED'
    ) NOT NULL DEFAULT 'ACTIVE',

    valid_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    valid_until TIMESTAMP NULL,

    created_by_user_id INT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_temp_rescue_allocation
        FOREIGN KEY (rescue_allocation_id)
        REFERENCES rescue_allocations(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT fk_temp_student
        FOREIGN KEY (student_id)
        REFERENCES students(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_temp_bus
        FOREIGN KEY (temporary_bus_id)
        REFERENCES buses(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_temp_route
        FOREIGN KEY (route_id)
        REFERENCES routes(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT fk_temp_user
        FOREIGN KEY (created_by_user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    INDEX idx_temp_student (student_id),
    INDEX idx_temp_bus (temporary_bus_id),
    INDEX idx_temp_status (status),
    INDEX idx_temp_rescue (rescue_allocation_id)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 12. BOARDING RECORDS
-- Stores every boarding/access attempt.
--
-- Boarding type:
-- NORMAL = regular assigned bus
-- RESCUE = temporary rescue/alternate bus
-- ============================================================

CREATE TABLE boarding_records (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,

    student_id INT NOT NULL,

    bus_id INT NOT NULL,
    route_id INT NULL,

    rfid_card_id INT NULL,

    temporary_authorization_id BIGINT NULL,

    rfid_verified BOOLEAN NOT NULL DEFAULT FALSE,
    face_verified BOOLEAN NOT NULL DEFAULT FALSE,

    access_result ENUM(
        'GRANTED',
        'DENIED'
    ) NOT NULL,

    denial_reason ENUM(
        'INVALID_RFID',
        'FACE_MISMATCH',
        'WRONG_BUS',
        'INVALID_ROUTE',
        'STUDENT_INACTIVE',
        'NO_AUTHORIZATION',
        'OTHER'
    ) NULL,

    boarding_type ENUM(
        'NORMAL',
        'RESCUE'
    ) NOT NULL DEFAULT 'NORMAL',

    boarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_boarding_student
        FOREIGN KEY (student_id)
        REFERENCES students(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_boarding_bus
        FOREIGN KEY (bus_id)
        REFERENCES buses(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_boarding_route
        FOREIGN KEY (route_id)
        REFERENCES routes(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT fk_boarding_rfid
        FOREIGN KEY (rfid_card_id)
        REFERENCES rfid_cards(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT fk_boarding_temp_auth
        FOREIGN KEY (temporary_authorization_id)
        REFERENCES temporary_authorizations(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    INDEX idx_boarding_student (student_id),
    INDEX idx_boarding_bus_time (bus_id, boarded_at),
    INDEX idx_boarding_route (route_id),
    INDEX idx_boarding_result (access_result),
    INDEX idx_boarding_type (boarding_type)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- FINAL VERIFICATION
-- ============================================================

SHOW TABLES;
SELECT COUNT(*) AS table_count
FROM information_schema.tables
WHERE table_schema = 'smartbus';
