-- ============================================================
-- SMARTBUS MIGRATION 002 - AUDIT UNKNOWN CARDS
-- ============================================================
-- Why:
--   A denied attempt with an unregistered card had nowhere to be recorded,
--   because boarding_records.student_id was NOT NULL and there is no student
--   to point at. That is exactly the event an operator most wants to see, so
--   the row may now carry the attempted UID without a student.
--
-- Safety:
--   Additive. No row is deleted, no existing value changes. Loosening
--   NOT NULL does not rewrite any stored row.
-- ============================================================

ALTER TABLE boarding_records
    MODIFY student_id INT NULL,

    ADD COLUMN attempted_rfid_uid VARCHAR(100) NULL AFTER student_id,

    ADD INDEX idx_boarding_attempted_uid (attempted_rfid_uid);
