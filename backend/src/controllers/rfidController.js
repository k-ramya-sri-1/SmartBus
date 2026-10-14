const db = require("../config/database");

// Register RFID card
const registerRFID = async (req, res) => {
    try {
        const { student_id, rfid_uid } = req.body;

        if (!student_id || !rfid_uid) {
            return res.status(400).json({
                success: false,
                message: "student_id and rfid_uid are required"
            });
        }

        // Check whether student exists
        const [students] = await db.query(
            "SELECT id, student_id, name FROM students WHERE student_id = ?",
            [student_id]
        );

        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Student not found"
            });
        }

        // Check whether RFID already exists
        const [existingRFID] = await db.query(
            "SELECT id FROM rfid_cards WHERE rfid_uid = ?",
            [rfid_uid]
        );

        if (existingRFID.length > 0) {
            return res.status(409).json({
                success: false,
                message: "RFID card already registered"
            });
        }

        // Register RFID
        const [result] = await db.query(
            `INSERT INTO rfid_cards (student_id, rfid_uid)
             VALUES (?, ?)`,
            [students[0].id, rfid_uid]
        );

        res.status(201).json({
            success: true,
            message: "RFID card registered successfully",
            id: result.insertId,
            student: {
                student_id: students[0].student_id,
                name: students[0].name
            },
            rfid_uid
        });

    } catch (error) {
        console.error("Register RFID error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to register RFID",
            error: error.message
        });
    }
};


// Get student using RFID UID
const getStudentByRFID = async (req, res) => {
    try {
        const { uid } = req.params;

        const [records] = await db.query(
            `SELECT
                r.id AS rfid_card_id,
                r.rfid_uid,
                r.status AS rfid_status,
                s.id AS student_db_id,
                s.student_id,
                s.name,
                s.email,
                s.phone,
                s.status AS student_status
             FROM rfid_cards r
             JOIN students s ON r.student_id = s.id
             WHERE r.rfid_uid = ?`,
            [uid]
        );

        if (records.length === 0) {
            return res.status(404).json({
                success: false,
                message: "RFID card not found"
            });
        }

        res.json({
            success: true,
            student: records[0]
        });

    } catch (error) {
        console.error("Get RFID error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to fetch RFID information",
            error: error.message
        });
    }
};


module.exports = {
    registerRFID,
    getStudentByRFID
};