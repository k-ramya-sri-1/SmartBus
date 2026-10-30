/**
 * Express application factory.
 *
 * Splitting the app from the listener lets the integration tests start the
 * real middleware stack on an ephemeral port against a throwaway database.
 */

const express = require("express");
const cors = require("cors");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const config = require("./config/env");
const db = require("./config/database");
const { notFoundHandler, errorHandler } = require("./middleware/errors");
const { createRateLimiter } = require("./middleware/rateLimit");
const faceServiceClient = require("./services/faceServiceClient");

const authRoutes = require("./routes/authRoutes");
const studentRoutes = require("./routes/studentRoutes");
const rfidRoutes = require("./routes/rfidRoutes");
const busRoutes = require("./routes/busRoutes");
const routeRoutes = require("./routes/routeRoutes");
const assignmentRoutes = require("./routes/assignmentRoutes");
const boardingRoutes = require("./routes/boardingRoutes");
const authorizationRoutes = require("./routes/authorizationRoutes");
const faceRoutes = require("./routes/faceRoutes");
const gpsRoutes = require("./routes/gpsRoutes");
const emergencyRoutes = require("./routes/emergencyRoutes");
const rescueRoutes = require("./routes/rescueRoutes");
const rescueAuthorizationRoutes = require("./routes/rescueAuthorizationRoutes");
const missedBusRoutes = require("./routes/missedBusRoutes");
const deviceRoutes = require("./routes/deviceRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const routeWaypointRoutes = require("./routes/routeWaypointRoutes");

function createApp() {
    const app = express();
    const server = http.createServer(app);

    const io = new Server(server, {
        cors: {
            origin: config.corsOrigins,
            methods: ["GET", "POST"]
        }
    });

    app.set("io", io);
    app.set("trust proxy", true);
    app.disable("x-powered-by");

    app.use(cors({ origin: config.corsOrigins }));
    app.use(express.json({ limit: "8mb" }));
    app.use(express.urlencoded({ extended: false, limit: "1mb" }));

    // --- Real-time dashboard feeds -----------------------------------
    // A dashboard must not receive live student movement without signing in.
    io.use((socket, next) => {
        if (!config.socketAuthRequired) {
            return next();
        }

        try {
            jwt.verify((socket.handshake.auth || {}).token, config.jwtSecret);
            return next();
        } catch {
            return next(new Error("UNAUTHORIZED"));
        }
    });

    io.on("connection", (socket) => {
        console.log(`Socket.IO client connected: ${socket.id}`);

        socket.on("disconnect", () => {
            console.log(`Socket.IO client disconnected: ${socket.id}`);
        });
    });

    // --- Health ------------------------------------------------------
    app.get("/", (req, res) => {
        res.json({
            success: true,
            message: "SmartBus Backend is running!",
            version: "2.0.0"
        });
    });

    app.get("/api/health/db", async (req, res) => {
        try {
            const [result] = await db.query("SELECT 1 AS database_connected");

            res.json({
                success: true,
                message: "SmartBus Backend connected to MySQL successfully!",
                database: result
            });
        } catch (error) {
            console.error("Database connection error:", error.message);

            res.status(500).json({
                success: false,
                error: "DATABASE_UNAVAILABLE",
                message: "Database connection failed"
            });
        }
    });

    app.get("/api/health", async (req, res) => {
        const face = await faceServiceClient.health();

        res.status(face.available ? 200 : 503).json({
            success: face.available,
            backend: true,
            face_service: face.available,
            face_engine: face.engine || null,
            enrolled_faces: face.enrolled_students ?? null,
            server_time: new Date().toISOString()
        });
    });

    // --- Rate limiters -----------------------------------------------
    const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 10, keyPrefix: "login" });
    const deviceLimiter = createRateLimiter({ windowMs: 60_000, max: 120, keyPrefix: "device" });
    const faceLimiter = createRateLimiter({ windowMs: 60_000, max: 60, keyPrefix: "face" });

    // --- Routes ------------------------------------------------------
    app.use("/api/auth", loginLimiter);
    app.use("/api/auth", authRoutes);

    app.use("/api/students", studentRoutes);
    app.use("/api/buses", busRoutes);
    app.use("/api/routes", routeRoutes);
    app.use("/api/assignments", assignmentRoutes);

    app.use("/api/rfid", deviceLimiter, rfidRoutes);
    app.use("/api/face", faceLimiter, faceRoutes);
    app.use("/api/authorization", deviceLimiter, authorizationRoutes);
    app.use("/api/gps", deviceLimiter, gpsRoutes);

    app.use("/api/boarding", boardingRoutes);
    app.use("/api/emergency", emergencyRoutes);
    app.use("/api/rescue", rescueRoutes);
    app.use("/api/rescue", rescueAuthorizationRoutes);
    app.use("/api/missed-bus", missedBusRoutes);

    app.use("/api/devices", deviceRoutes);
    app.use("/api/settings", settingsRoutes);
    app.use("/api/route-waypoints", routeWaypointRoutes);

    // Kept for backwards compatibility with the original admin probe.
    app.get(
        "/api/auth/admin-test",
        require("./middleware/authMiddleware").authenticateToken,
        require("./middleware/authMiddleware").authorizeRoles("ADMIN"),
        (req, res) => {
            res.json({ success: true, message: "Admin access granted." });
        }
    );

    app.use(notFoundHandler);
    app.use(errorHandler);

    return { app, server, io };
}

module.exports = { createApp };
