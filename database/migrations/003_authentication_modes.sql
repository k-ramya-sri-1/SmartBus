-- ============================================================
-- SMARTBUS MIGRATION 003 - EXPLICIT AUTHENTICATION MODES
-- ============================================================
-- Adds explicit RFID versus camera-only provenance.
-- Existing rows receive the RFID default. Existing foreign keys,
-- indexes, and RFID values are preserved.
-- ============================================================

ALTER TABLE face_verifications
    MODIFY rfid_card_id INT NULL,

    ADD COLUMN authentication_mode ENUM(
        'RFID',
        'CAMERA_ONLY'
    ) NOT NULL DEFAULT 'RFID' AFTER device_id;

ALTER TABLE boarding_records
    ADD COLUMN authentication_mode ENUM(
        'RFID',
        'CAMERA_ONLY'
    ) NOT NULL DEFAULT 'RFID' AFTER device_id;
