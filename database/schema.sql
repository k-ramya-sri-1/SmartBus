-- ============================================================
-- SMARTBUS RESCUE AND ACCESS MANAGEMENT SYSTEM
-- DATABASE SCHEMA (authoritative bootstrap script)
-- ============================================================
--
-- This file is generated from the live database by
--   node database/export-schema.js
-- so it always matches the structure the application actually
-- runs against. Regenerate it after applying a migration.
--
-- WARNING: this script DROPS and recreates SmartBus tables.
-- It is meant for a fresh install. To upgrade a database that
-- already holds data, run the additive migration instead:
--   node database/migrate.js
--
-- Business rules encoded in this schema:
--   * A student has one permanent bus assignment (bus_assignments).
--     Rescue, missed-bus and Fest Mode never overwrite it; they are
--     expressed as temporary_authorizations instead.
--   * Every access attempt is a boarding_records row that carries the
--     evidence behind the decision: RFID result, face result, face
--     score, GPS status and route deviation.
--   * Face templates are 128-D embeddings held by the face service.
--     face_profiles only records that enrollment exists, so no raw
--     face image is ever stored in this database.
--   * devices.api_key_hash is a SHA-256 hash; the plaintext device key
--     lives only in the ESP32 firmware configuration.
-- ============================================================

CREATE DATABASE IF NOT EXISTS smartbus;
USE smartbus;

-- ============================================================
-- DROP (reverse dependency order)
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS schema_migrations;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS boarding_records;
DROP TABLE IF EXISTS face_verifications;
DROP TABLE IF EXISTS temporary_authorizations;
DROP TABLE IF EXISTS rescue_allocations;
DROP TABLE IF EXISTS emergency_events;
DROP TABLE IF EXISTS gps_locations;
DROP TABLE IF EXISTS route_waypoints;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS face_profiles;
DROP TABLE IF EXISTS rfid_cards;
DROP TABLE IF EXISTS bus_assignments;
DROP TABLE IF EXISTS bus_routes;
DROP TABLE IF EXISTS routes;
DROP TABLE IF EXISTS buses;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS students;

SET FOREIGN_KEY_CHECKS = 1;


-- ============================================================
-- students
-- ============================================================

CREATE TABLE `students` (
  `id` int NOT NULL AUTO_INCREMENT,
  `student_id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `email` varchar(150) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `status` enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `student_id` (`student_id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- users
-- ============================================================

CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('ADMIN','TRANSPORT_MANAGER','DRIVER','CONDUCTOR') NOT NULL,
  `status` enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- buses
-- ============================================================

CREATE TABLE `buses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bus_number` varchar(30) NOT NULL,
  `registration_number` varchar(30) DEFAULT NULL,
  `maximum_capacity` int NOT NULL,
  `status` enum('ACTIVE','INACTIVE','MAINTENANCE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bus_number` (`bus_number`),
  UNIQUE KEY `registration_number` (`registration_number`),
  CONSTRAINT `chk_bus_capacity` CHECK ((`maximum_capacity` > 0))
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- routes
-- ============================================================

CREATE TABLE `routes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `route_name` varchar(100) NOT NULL,
  `starting_point` varchar(150) NOT NULL,
  `destination` varchar(150) NOT NULL,
  `description` text,
  `status` enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- bus_routes
-- ============================================================

CREATE TABLE `bus_routes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bus_id` int NOT NULL,
  `route_id` int NOT NULL,
  `status` enum('ACTIVE','INACTIVE') DEFAULT 'ACTIVE',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bus_route` (`bus_id`,`route_id`),
  KEY `fk_bus_routes_route` (`route_id`),
  CONSTRAINT `fk_bus_routes_bus` FOREIGN KEY (`bus_id`) REFERENCES `buses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bus_routes_route` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- bus_assignments
-- ============================================================

CREATE TABLE `bus_assignments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `bus_id` int NOT NULL,
  `route_id` int NOT NULL,
  `assignment_status` enum('ACTIVE','INACTIVE','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
  `valid_from` date NOT NULL,
  `valid_to` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_assignment_student` (`student_id`),
  KEY `idx_assignment_bus` (`bus_id`),
  KEY `idx_assignment_route` (`route_id`),
  KEY `idx_assignment_status` (`assignment_status`),
  CONSTRAINT `fk_assignment_bus` FOREIGN KEY (`bus_id`) REFERENCES `buses` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_assignment_route` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_assignment_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- rfid_cards
-- ============================================================

CREATE TABLE `rfid_cards` (
  `id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `rfid_uid` varchar(100) NOT NULL,
  `status` enum('ACTIVE','INACTIVE','LOST','BLOCKED') NOT NULL DEFAULT 'ACTIVE',
  `issued_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `last_verified_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `rfid_uid` (`rfid_uid`),
  KEY `idx_rfid_student` (`student_id`),
  CONSTRAINT `fk_rfid_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- face_profiles
-- ============================================================

CREATE TABLE `face_profiles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `profile_reference` varchar(255) NOT NULL,
  `engine` varchar(40) DEFAULT NULL,
  `template_count` int NOT NULL DEFAULT '0',
  `enrolled_by_user_id` int DEFAULT NULL,
  `last_enrolled_at` timestamp NULL DEFAULT NULL,
  `verification_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `student_id` (`student_id`),
  KEY `fk_face_enroller` (`enrolled_by_user_id`),
  CONSTRAINT `fk_face_enroller` FOREIGN KEY (`enrolled_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_face_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- devices
-- ============================================================

CREATE TABLE `devices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_uid` varchar(64) NOT NULL,
  `bus_id` int NOT NULL,
  `api_key_hash` char(64) NOT NULL,
  `label` varchar(120) DEFAULT NULL,
  `status` enum('ACTIVE','INACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  `firmware_version` varchar(40) DEFAULT NULL,
  `last_seen_at` timestamp NULL DEFAULT NULL,
  `created_by_user_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `device_uid` (`device_uid`),
  KEY `fk_device_user` (`created_by_user_id`),
  KEY `idx_device_bus` (`bus_id`),
  KEY `idx_device_status` (`status`),
  CONSTRAINT `fk_device_bus` FOREIGN KEY (`bus_id`) REFERENCES `buses` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_device_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- route_waypoints
-- ============================================================

CREATE TABLE `route_waypoints` (
  `id` int NOT NULL AUTO_INCREMENT,
  `route_id` int NOT NULL,
  `sequence_no` int NOT NULL,
  `latitude` decimal(10,7) NOT NULL,
  `longitude` decimal(10,7) NOT NULL,
  `label` varchar(120) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_waypoint_sequence` (`route_id`,`sequence_no`),
  CONSTRAINT `fk_waypoint_route` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- gps_locations
-- ============================================================

CREATE TABLE `gps_locations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `bus_id` int NOT NULL,
  `latitude` decimal(10,7) NOT NULL,
  `longitude` decimal(10,7) NOT NULL,
  `speed` decimal(6,2) DEFAULT NULL,
  `fix_status` enum('GPS_FIX','GPS_STALE','UNAVAILABLE') NOT NULL DEFAULT 'GPS_FIX',
  `satellites` tinyint unsigned DEFAULT NULL,
  `hdop` decimal(5,2) DEFAULT NULL,
  `source_time` datetime DEFAULT NULL,
  `route_deviation_m` decimal(10,1) DEFAULT NULL,
  `device_id` int DEFAULT NULL,
  `recorded_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_gps_bus_time` (`bus_id`,`recorded_at`),
  KEY `fk_gps_device` (`device_id`),
  KEY `idx_gps_fix_status` (`fix_status`),
  CONSTRAINT `fk_gps_bus` FOREIGN KEY (`bus_id`) REFERENCES `buses` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_gps_device` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- emergency_events
-- ============================================================

CREATE TABLE `emergency_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `bus_id` int NOT NULL,
  `reported_by_user_id` int DEFAULT NULL,
  `device_id` int DEFAULT NULL,
  `event_type` enum('SOS','BREAKDOWN','ACCIDENT','OTHER') NOT NULL,
  `description` text,
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `location_status` enum('GPS_FIX','GPS_STALE','UNAVAILABLE') NOT NULL DEFAULT 'UNAVAILABLE',
  `status` enum('OPEN','IN_PROGRESS','RESOLVED','CANCELLED') NOT NULL DEFAULT 'OPEN',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `resolved_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_emergency_user` (`reported_by_user_id`),
  KEY `idx_emergency_bus` (`bus_id`),
  KEY `idx_emergency_status` (`status`),
  KEY `fk_emergency_device` (`device_id`),
  CONSTRAINT `fk_emergency_bus` FOREIGN KEY (`bus_id`) REFERENCES `buses` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_emergency_device` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_emergency_user` FOREIGN KEY (`reported_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- rescue_allocations
-- ============================================================

CREATE TABLE `rescue_allocations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `emergency_event_id` bigint NOT NULL,
  `student_id` int NOT NULL,
  `rescue_bus_id` int NOT NULL,
  `allocation_status` enum('ALLOCATED','BOARDED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'ALLOCATED',
  `allocated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rescue_emergency` (`emergency_event_id`),
  KEY `idx_rescue_student` (`student_id`),
  KEY `idx_rescue_bus` (`rescue_bus_id`),
  KEY `idx_rescue_status` (`allocation_status`),
  CONSTRAINT `fk_rescue_bus` FOREIGN KEY (`rescue_bus_id`) REFERENCES `buses` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_rescue_emergency` FOREIGN KEY (`emergency_event_id`) REFERENCES `emergency_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_rescue_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- temporary_authorizations
-- ============================================================

CREATE TABLE `temporary_authorizations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `rescue_allocation_id` bigint DEFAULT NULL,
  `student_id` int NOT NULL,
  `temporary_bus_id` int NOT NULL,
  `route_id` int DEFAULT NULL,
  `authorization_type` enum('EMERGENCY_RESCUE','MISSED_BUS','OTHER') NOT NULL,
  `purpose` varchar(255) DEFAULT NULL,
  `status` enum('ACTIVE','USED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  `valid_from` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `valid_until` timestamp NULL DEFAULT NULL,
  `created_by_user_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_temp_route` (`route_id`),
  KEY `fk_temp_user` (`created_by_user_id`),
  KEY `idx_temp_student` (`student_id`),
  KEY `idx_temp_bus` (`temporary_bus_id`),
  KEY `idx_temp_status` (`status`),
  KEY `idx_temp_rescue` (`rescue_allocation_id`),
  CONSTRAINT `fk_temp_bus` FOREIGN KEY (`temporary_bus_id`) REFERENCES `buses` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_temp_rescue_allocation` FOREIGN KEY (`rescue_allocation_id`) REFERENCES `rescue_allocations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_temp_route` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_temp_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_temp_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- face_verifications
-- ============================================================

CREATE TABLE `face_verifications` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `token_id` char(36) NOT NULL,
  `student_id` int NOT NULL,
  `rfid_card_id` int DEFAULT NULL,
  `device_id` int NOT NULL,
  `authentication_mode` enum('RFID','CAMERA_ONLY') NOT NULL DEFAULT 'RFID',
  `matched_student_id` int DEFAULT NULL,
  `score` decimal(6,5) DEFAULT NULL,
  `decision` enum('MATCH','NO_FACE','MULTIPLE_FACES','LOW_SCORE','DIFFERENT_STUDENT','ENGINE_UNAVAILABLE','ENGINE_ERROR') NOT NULL,
  `engine` varchar(40) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_id` (`token_id`),
  KEY `fk_facever_card` (`rfid_card_id`),
  KEY `fk_facever_matched` (`matched_student_id`),
  KEY `idx_facever_student` (`student_id`,`created_at`),
  KEY `idx_facever_expiry` (`expires_at`),
  KEY `idx_facever_device` (`device_id`,`created_at`),
  CONSTRAINT `fk_facever_card` FOREIGN KEY (`rfid_card_id`) REFERENCES `rfid_cards` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_facever_device` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_facever_matched` FOREIGN KEY (`matched_student_id`) REFERENCES `students` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_facever_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- boarding_records
-- ============================================================

CREATE TABLE `boarding_records` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `student_id` int DEFAULT NULL,
  `attempted_rfid_uid` varchar(100) DEFAULT NULL,
  `bus_id` int NOT NULL,
  `route_id` int DEFAULT NULL,
  `device_id` int DEFAULT NULL,
  `authentication_mode` enum('RFID','CAMERA_ONLY') NOT NULL DEFAULT 'RFID',
  `rfid_card_id` int DEFAULT NULL,
  `temporary_authorization_id` bigint DEFAULT NULL,
  `face_verification_id` bigint DEFAULT NULL,
  `rfid_verified` tinyint(1) NOT NULL DEFAULT '0',
  `face_verified` tinyint(1) NOT NULL DEFAULT '0',
  `face_score` decimal(6,5) DEFAULT NULL,
  `gps_status` enum('GPS_FIX','GPS_STALE','UNAVAILABLE') DEFAULT NULL,
  `route_deviation_m` decimal(10,1) DEFAULT NULL,
  `access_result` enum('GRANTED','DENIED') NOT NULL,
  `denial_reason` enum('INVALID_RFID','FACE_MISMATCH','WRONG_BUS','INVALID_ROUTE','STUDENT_INACTIVE','NO_AUTHORIZATION','OTHER','FACE_UNAVAILABLE','FACE_TIMEOUT','FACE_INVALID','FACE_NOT_PERFORMED','DEVICE_UNAUTHORIZED','ROUTE_DEVIATION','SYSTEM_ERROR') DEFAULT NULL,
  `boarding_type` enum('NORMAL','RESCUE','FEST') NOT NULL DEFAULT 'NORMAL',
  `boarded_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `client_event_id` varchar(80) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_boarding_client_event` (`client_event_id`),
  KEY `fk_boarding_rfid` (`rfid_card_id`),
  KEY `fk_boarding_temp_auth` (`temporary_authorization_id`),
  KEY `idx_boarding_student` (`student_id`),
  KEY `idx_boarding_bus_time` (`bus_id`,`boarded_at`),
  KEY `idx_boarding_route` (`route_id`),
  KEY `idx_boarding_result` (`access_result`),
  KEY `idx_boarding_type` (`boarding_type`),
  KEY `fk_boarding_device` (`device_id`),
  KEY `fk_boarding_facever` (`face_verification_id`),
  KEY `idx_boarding_attempted_uid` (`attempted_rfid_uid`),
  CONSTRAINT `fk_boarding_bus` FOREIGN KEY (`bus_id`) REFERENCES `buses` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_boarding_device` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_boarding_facever` FOREIGN KEY (`face_verification_id`) REFERENCES `face_verifications` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_boarding_rfid` FOREIGN KEY (`rfid_card_id`) REFERENCES `rfid_cards` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_boarding_route` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_boarding_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_boarding_temp_auth` FOREIGN KEY (`temporary_authorization_id`) REFERENCES `temporary_authorizations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- system_settings
-- ============================================================

CREATE TABLE `system_settings` (
  `setting_key` varchar(64) NOT NULL,
  `setting_value` varchar(255) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `updated_by_user_id` int DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`),
  KEY `fk_setting_user` (`updated_by_user_id`),
  CONSTRAINT `fk_setting_user` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- schema_migrations
-- ============================================================

CREATE TABLE `schema_migrations` (
  `migration_id` varchar(120) NOT NULL,
  `checksum` char(32) NOT NULL,
  `applied_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`migration_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- DEFAULT SETTINGS
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
     'A fix older than this is reported as GPS_STALE, never as valid.');

-- ============================================================
-- VERIFICATION
-- ============================================================

SHOW TABLES;
SELECT COUNT(*) AS table_count
FROM information_schema.tables
WHERE table_schema = 'smartbus';
