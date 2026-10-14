const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/database");

async function register(req, res) {
    try {
        const { username, email, password, role } = req.body;

        if (
            typeof username !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !username.trim() ||
            !email.trim() ||
            password.length < 12
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Username, email, and a password of at least 12 characters are required."
            });
        }

        const allowedRoles = [
            "ADMIN",
            "TRANSPORT_MANAGER",
            "DRIVER",
            "CONDUCTOR"
        ];

        if (!allowedRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                message: "A valid user role is required."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const normalizedUsername = username.trim();

        const [existingUsers] = await db.query(
            "SELECT id FROM users WHERE username = ? OR email = ?",
            [normalizedUsername, normalizedEmail]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Username or email already exists."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const [result] = await db.query(
            `INSERT INTO users
             (username, email, password_hash, role, status)
             VALUES (?, ?, ?, ?, 'ACTIVE')`,
            [
                normalizedUsername,
                normalizedEmail,
                passwordHash,
                role
            ]
        );

        return res.status(201).json({
            success: true,
            message: "User registered successfully.",
            user: {
                id: result.insertId,
                username: normalizedUsername,
                email: normalizedEmail,
                role
            }
        });
    } catch (error) {
        console.error("Registration error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to register user."
        });
    }
}

async function login(req, res) {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required."
            });
        }

        const [users] = await db.query(
            `SELECT id, username, email, password_hash, role, status
             FROM users
             WHERE email = ?
             LIMIT 1`,
            [email.trim().toLowerCase()]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        const user = users[0];

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches || user.status !== "ACTIVE") {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is not configured.");
        }

        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            },
            process.env.JWT_SECRET,
            {
                expiresIn: process.env.JWT_EXPIRES_IN || "1h"
            }
        );

        return res.json({
            success: true,
            message: "Login successful.",
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error("Login error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to log in."
        });
    }
}

async function getProfile(req, res) {
    try {
        const [users] = await db.query(
            `SELECT id, username, email, role, status
             FROM users
             WHERE id = ?
             LIMIT 1`,
            [req.user.id]
        );

        if (users.length === 0 || users[0].status !== "ACTIVE") {
            return res.status(401).json({
                success: false,
                message: "User account is unavailable."
            });
        }

        return res.json({
            success: true,
            user: users[0]
        });
    } catch (error) {
        console.error("Profile error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to retrieve profile."
        });
    }
}

module.exports = {
    register,
    login,
    getProfile
};