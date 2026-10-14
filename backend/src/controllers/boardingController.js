const db = require("../config/database");

// Create a boarding record
const createBoardingRecord = async (req, res) => {
    try {
        const {
            student_id,
            bus_id,
            route_id,
            rfid_card_id,
            temporary_authorization_id,
            rfid_verified,
            face_verified,
            access_result,
            denial_reason,
            boarding_type
        } = req.body;

        // Required fields
        if (!student_id || !bus_id || !route_id) {
            return res.status(400).json({
                success: false,
                message: "student_id, bus_id and route_id are required"
            });
        }

        // Check student
        const [students] = await db.query(
            "SELECT id, student_id, name, status FROM students WHERE id = ?",
            [student_id]
        );

        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Student not found"
            });
        }

        // Check bus
        const [buses] = await db.query(
            "SELECT id, bus_number, status FROM buses WHERE id = ?",
            [bus_id]
        );

        if (buses.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Bus not found"
            });
        }

        // Check route
        const [routes] = await db.query(
            "SELECT id, route_name, status FROM routes WHERE id = ?",
            [route_id]
        );

        if (routes.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Route not found"
            });
        }

        // If RFID card ID is provided, verify it exists
        if (rfid_card_id) {
            const [rfidCards] = await db.query(
                `SELECT id, student_id, rfid_uid, status
                 FROM rfid_cards
                 WHERE id = ?`,
                [rfid_card_id]
            );

            if (rfidCards.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "RFID card not found"
                });
            }

            // Make sure RFID card belongs to the same student
            if (rfidCards[0].student_id !== student_id) {
                return res.status(400).json({
                    success: false,
                    message: "RFID card does not belong to this student"
                });
            }
        }

        // Insert boarding record
        const [result] = await db.query(
            `INSERT INTO boarding_records
            (
                student_id,
                bus_id,
                route_id,
                rfid_card_id,
                temporary_authorization_id,
                rfid_verified,
                face_verified,
                access_result,
                denial_reason,
                boarding_type
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                student_id,
                bus_id,
                route_id,
                rfid_card_id || null,
                temporary_authorization_id || null,
                rfid_verified || false,
                face_verified || false,
                access_result || "DENIED",
                denial_reason || null,
                boarding_type || "NORMAL"
            ]
        );

        res.status(201).json({
            success: true,
            message: "Boarding record created successfully",
            id: result.insertId
        });

    } catch (error) {
        console.error("Create boarding record error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to create boarding record",
            error: error.message
        });
    }
};


// Get all boarding records
const getAllBoardingRecords = async (req, res) => {
    try {
        const [records] = await db.query(`
            SELECT
                br.id,
                s.student_id,
                s.name AS student_name,
                b.bus_number,
                r.route_name,
                br.rfid_card_id,
                br.rfid_verified,
                br.face_verified,
                br.access_result,
                br.denial_reason,
                br.boarding_type,
                br.boarded_at
            FROM boarding_records br
            JOIN students s ON br.student_id = s.id
            JOIN buses b ON br.bus_id = b.id
            JOIN routes r ON br.route_id = r.id
            ORDER BY br.id DESC
        `);

        res.json({
            success: true,
            count: records.length,
            records
        });

    } catch (error) {
        console.error("Get boarding records error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to fetch boarding records",
            error: error.message
        });
    }
};


// Get boarding record by ID
const getBoardingRecordById = async (req, res) => {
    try {
        const { id } = req.params;

        const [records] = await db.query(`
            SELECT
                br.id,
                br.student_id,
                br.bus_id,
                br.route_id,
                br.rfid_card_id,
                br.temporary_authorization_id,
                br.rfid_verified,
                br.face_verified,
                br.access_result,
                br.denial_reason,
                br.boarding_type,
                br.boarded_at,
                s.student_id AS student_code,
                s.name AS student_name,
                b.bus_number,
                r.route_name
            FROM boarding_records br
            JOIN students s ON br.student_id = s.id
            JOIN buses b ON br.bus_id = b.id
            JOIN routes r ON br.route_id = r.id
            WHERE br.id = ?
        `, [id]);

        if (records.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Boarding record not found"
            });
        }

        res.json({
            success: true,
            record: records[0]
        });

    } catch (error) {
        console.error("Get boarding record error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to fetch boarding record",
            error: error.message
        });
    }
};


module.exports = {
    createBoardingRecord,
    getAllBoardingRecords,
    getBoardingRecordById
};