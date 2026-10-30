#!/usr/bin/env node
/**
 * Export the live schema into database/schema.sql.
 *
 *   node database/export-schema.js                  # write database/schema.sql
 *   node database/export-schema.js --print          # print to stdout
 *   node database/export-schema.js --source=smartbus --out=database/schema.sql
 *
 * The generated file is the authoritative bootstrap script: creating a fresh
 * database from it must reproduce the live structure exactly. tables are
 * emitted in foreign-key dependency order.
 */

const fs = require("node:fs");
const path = require("node:path");

const backendDir = path.resolve(__dirname, "..", "backend");
require(path.join(backendDir, "node_modules", "dotenv")).config({
    path: path.join(backendDir, ".env"),
    quiet: true
});

const mysql = require(path.join(backendDir, "node_modules", "mysql2", "promise"));

// Parents before children.
const TABLE_ORDER = [
    "students",
    "users",
    "buses",
    "routes",
    "bus_routes",
    "bus_assignments",
    "rfid_cards",
    "face_profiles",
    "devices",
    "route_waypoints",
    "gps_locations",
    "emergency_events",
    "rescue_allocations",
    "temporary_authorizations",
    "face_verifications",
    "boarding_records",
    "system_settings",
    "schema_migrations"
];

function parseArgs(argv) {
    const options = {
        print: false,
        source: process.env.DB_NAME,
        out: path.join(__dirname, "schema.sql")
    };

    for (const arg of argv) {
        if (arg === "--print") {
            options.print = true;
        } else if (arg.startsWith("--source=")) {
            options.source = arg.slice("--source=".length).trim();
        } else if (arg.startsWith("--out=")) {
            options.out = arg.slice("--out=".length).trim();
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return options;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: options.source
    });

    const [rows] = await connection.query(
        `SELECT table_name AS name
           FROM information_schema.tables
          WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
        [options.source]
    );

    const existing = new Set(rows.map((row) => row.name || row.NAME));
    const ordered = [
        ...TABLE_ORDER.filter((name) => existing.has(name)),
        ...[...existing].filter((name) => !TABLE_ORDER.includes(name)).sort()
    ];

    const missing = TABLE_ORDER.filter((name) => !existing.has(name));
    if (missing.length > 0) {
        console.warn(`! Tables listed in TABLE_ORDER but missing in ${options.source}: ${missing.join(", ")}`);
    }

    const ddl = new Map();

    for (const name of ordered) {
        const [result] = await connection.query(`SHOW CREATE TABLE \`${name}\``);
        const createSql = result[0]["Create Table"];
        ddl.set(name, createSql);
    }

    await connection.end();

    const lines = [];

    lines.push("-- ============================================================");
    lines.push("-- SMARTBUS RESCUE AND ACCESS MANAGEMENT SYSTEM");
    lines.push("-- DATABASE SCHEMA (authoritative bootstrap script)");
    lines.push("-- ============================================================");
    lines.push("--");
    lines.push("-- This file is generated from the live database by");
    lines.push("--   node database/export-schema.js");
    lines.push("-- so it always matches the structure the application actually");
    lines.push("-- runs against. Regenerate it after applying a migration.");
    lines.push("--");
    lines.push("-- WARNING: this script DROPS and recreates SmartBus tables.");
    lines.push("-- It is meant for a fresh install. To upgrade a database that");
    lines.push("-- already holds data, run the additive migration instead:");
    lines.push("--   node database/migrate.js");
    lines.push("--");
    lines.push("-- Business rules encoded in this schema:");
    lines.push("--   * A student has one permanent bus assignment (bus_assignments).");
    lines.push("--     Rescue, missed-bus and Fest Mode never overwrite it; they are");
    lines.push("--     expressed as temporary_authorizations instead.");
    lines.push("--   * Every access attempt is a boarding_records row that carries the");
    lines.push("--     evidence behind the decision: RFID result, face result, face");
    lines.push("--     score, GPS status and route deviation.");
    lines.push("--   * Face templates are 128-D embeddings held by the face service.");
    lines.push("--     face_profiles only records that enrollment exists, so no raw");
    lines.push("--     face image is ever stored in this database.");
    lines.push("--   * devices.api_key_hash is a SHA-256 hash; the plaintext device key");
    lines.push("--     lives only in the ESP32 firmware configuration.");
    lines.push("-- ============================================================");
    lines.push("");
    lines.push("CREATE DATABASE IF NOT EXISTS smartbus;");
    lines.push("USE smartbus;");
    lines.push("");
    lines.push("-- ============================================================");
    lines.push("-- DROP (reverse dependency order)");
    lines.push("-- ============================================================");
    lines.push("");
    lines.push("SET FOREIGN_KEY_CHECKS = 0;");
    lines.push("");

    for (const name of [...ordered].reverse()) {
        lines.push(`DROP TABLE IF EXISTS ${name};`);
    }

    lines.push("");
    lines.push("SET FOREIGN_KEY_CHECKS = 1;");
    lines.push("");

    for (const name of ordered) {
        lines.push("");
        lines.push("-- ============================================================");
        lines.push(`-- ${name}`);
        lines.push("-- ============================================================");
        lines.push("");
        lines.push(`${ddl.get(name)};`);
    }

    lines.push("");
    lines.push("-- ============================================================");
    lines.push("-- DEFAULT SETTINGS");
    lines.push("-- ============================================================");
    lines.push("");
    lines.push("INSERT INTO system_settings (setting_key, setting_value, description)");
    lines.push("VALUES");
    lines.push("    ('operating_mode', 'NORMAL',");
    lines.push("     'NORMAL or FEST. Fest Mode follows report section 4.14.'),");
    lines.push("    ('fest_starts_at', '',");
    lines.push("     'ISO timestamp; empty means \"no scheduled window\".'),");
    lines.push("    ('fest_ends_at', '',");
    lines.push("     'ISO timestamp; empty means \"no scheduled window\".'),");
    lines.push("    ('route_deviation_enforce', 'false',");
    lines.push("     'true = deny access when the bus is off its configured route.'),");
    lines.push("    ('route_deviation_tolerance_m', '1500',");
    lines.push("     'Distance from the route polyline before a deviation is reported.'),");
    lines.push("    ('gps_max_fix_age_seconds', '120',");
    lines.push("     'A fix older than this is reported as GPS_STALE, never as valid.');");
    lines.push("");
    lines.push("-- ============================================================");
    lines.push("-- VERIFICATION");
    lines.push("-- ============================================================");
    lines.push("");
    lines.push("SHOW TABLES;");
    lines.push("SELECT COUNT(*) AS table_count");
    lines.push("FROM information_schema.tables");
    lines.push("WHERE table_schema = 'smartbus';");
    lines.push("");

    const content = lines.join("\n");

    if (options.print) {
        process.stdout.write(content);
    } else {
        fs.writeFileSync(options.out, content, "utf8");
        console.log(`Wrote ${options.out} (${ordered.length} tables, ${content.length} bytes)`);
    }
}

main().catch((error) => {
    console.error(`Export failed: ${error.message}`);
    process.exitCode = 1;
});
