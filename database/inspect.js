#!/usr/bin/env node
/**
 * SmartBus database inspector.
 *
 *   node database/inspect.js                 # row counts for every table
 *   node database/inspect.js --database=smartbus_test
 *   node database/inspect.js --schema         # also print column summaries
 *
 * Read-only: it never writes to the database.
 */

const path = require("node:path");

const backendDir = path.resolve(__dirname, "..", "backend");
require(path.join(backendDir, "node_modules", "dotenv")).config({
    path: path.join(backendDir, ".env"),
    quiet: true
});

const mysql = require(path.join(backendDir, "node_modules", "mysql2", "promise"));

function parseArgs(argv) {
    let database = null;
    let schema = false;

    for (const arg of argv) {
        if (arg === "--schema") {
            schema = true;
        } else if (arg.startsWith("--database=")) {
            database = arg.slice("--database=".length).trim();
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return { database, schema };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const database = options.database || process.env.DB_NAME;

    if (!database) {
        throw new Error("No database selected. Set DB_NAME or pass --database=NAME.");
    }

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database
    });

    const [tables] = await connection.query(
        `SELECT table_name AS name
           FROM information_schema.tables
          WHERE table_schema = ?
          ORDER BY table_name`,
        [database]
    );

    console.log(`Database: ${database}`);
    console.log(`Tables  : ${tables.length}`);
    console.log("");

    let total = 0;

    for (const table of tables) {
        const name = table.name || table.NAME;
        const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM \`${name}\``);
        const count = Number(rows[0].count);
        total += count;

        console.log(`${name.padEnd(32)} ${String(count).padStart(8)} rows`);

        if (options.schema) {
            const [columns] = await connection.query(
                `SELECT column_name AS name, column_type AS type, is_nullable AS nullable
                   FROM information_schema.columns
                  WHERE table_schema = ? AND table_name = ?
                  ORDER BY ordinal_position`,
                [database, name]
            );

            for (const column of columns) {
                const columnName = column.name || column.NAME;
                const columnType = column.type || column.TYPE;
                const nullable = (column.nullable || column.NULLABLE) === "YES" ? "NULL" : "NOT NULL";
                console.log(`    - ${columnName.padEnd(28)} ${String(columnType).padEnd(42)} ${nullable}`);
            }
        }
    }

    console.log("");
    console.log(`Total rows: ${total}`);

    await connection.end();
}

main().catch((error) => {
    console.error(`Inspection failed: ${error.message}`);
    process.exitCode = 1;
});
