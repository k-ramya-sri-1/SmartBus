const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");

const db = require("./config/database");
const studentRoutes = require("./routes/studentRoutes");
const rfidRoutes = require("./routes/rfidRoutes");
const busRoutes = require("./routes/busRoutes");
const routeRoutes = require("./routes/routeRoutes");
const assignmentRoutes = require("./routes/assignmentRoutes");
const boardingRoutes = require("./routes/boardingRoutes");
const authorizationRoutes = require("./routes/authorizationRoutes");
const gpsRoutes = require("./routes/gpsRoutes");
const emergencyRoutes = require("./routes/emergencyRoutes");
const rescueRoutes = require("./routes/rescueRoutes");
const rescueAuthorizationRoutes = require("./routes/rescueAuthorizationRoutes");
const missedBusRoutes =
    require("./routes/missedBusRoutes");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Create Socket.IO server
const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173",
        methods: ["GET", "POST"]
    }
});
const authRoutes = require("./routes/authRoutes");
const {
    authenticateToken,
    authorizeRoles
} = require("./middleware/authMiddleware");

// Make Socket.IO available to all routes/controllers
app.set("io", io);

// Middleware
app.use(cors());
app.use(express.json());

// API routes
app.use("/api/students", studentRoutes);
app.use("/api/rfid", rfidRoutes);
app.use("/api/buses", busRoutes);
app.use("/api/routes", routeRoutes);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/boarding", boardingRoutes);
app.use("/api/authorization", authorizationRoutes);
app.use("/api/gps", gpsRoutes);
app.use("/api/emergency", emergencyRoutes);
app.use("/api/rescue", rescueRoutes);
app.use("/api/rescue", rescueAuthorizationRoutes);
app.use(
    "/api/missed-bus",
    missedBusRoutes
);
app.use("/api/auth", authRoutes);


// Socket.IO connection
io.on("connection", (socket) => {
    console.log(
        `Socket.IO client connected: ${socket.id}`
    );

    socket.on("disconnect", () => {
        console.log(
            `Socket.IO client disconnected: ${socket.id}`
        );
    });
});

// Home route
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "SmartBus Backend is running!"
    });
});

// Database health check
app.get("/api/health/db", async (req, res) => {
    try {
        const [result] = await db.query(
            "SELECT 1 AS database_connected"
        );

        res.json({
            success: true,
            message:
                "SmartBus Backend connected to MySQL successfully!",
            database: result
        });
    } catch (error) {
        console.error(
            "Database connection error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Database connection failed",
            error: error.message
        });
    }
});
app.get(
    "/api/auth/admin-test",
    authenticateToken,
    authorizeRoles("ADMIN"),
    (req, res) => {
        res.json({
            success: true,
            message: "Admin access granted."
        });
    }
);

// Start server
server.listen(PORT, () => {
    console.log(
        `SmartBus Backend running on http://localhost:${PORT}`
    );
});