const mysql = require("mysql2/promise");
const path = require("node:path");
const dotenv = require("dotenv");

// Always load the backend's own .env file.
dotenv.config({
    path: path.resolve(__dirname, "../../.env")
});

const requiredVariables = [
    "DB_HOST",
    "DB_PORT",
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME"
];

const missingVariables = requiredVariables.filter(
    (name) => process.env[name] === undefined || process.env[name] === ""
);

if (missingVariables.length > 0) {
    throw new Error(
        `Missing database environment variables: ${missingVariables.join(", ")}`
    );
}

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;