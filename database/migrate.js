#!/usr/bin/env node
/**
 * SmartBus migration runner.
 *
 *   node database/migrate.js                 # apply pending migrations to DB_NAME
 *   node database/migrate.js --database=smartbus_test
 *   node database/migrate.js --dry-run       # inspect what would run, change nothing
 *   node database/migrate.js --database=smartbus --diagnose-migration-003
 *
 * Applied migrations are recorded in `schema_migrations`, so the script is
 * safe to run repeatedly. It never drops a table, a column or a row.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const backendDir = path.resolve(__dirname, "..", "backend");
require(path.join(backendDir, "node_modules", "dotenv")).config({
    path: path.join(backendDir, ".env"),
    quiet: true
});

const mysql = require(path.join(backendDir, "node_modules", "mysql2", "promise"));

const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const MIGRATION_003 = "003_authentication_modes";
const MIGRATION_STATES = Object.freeze({
    UNAPPLIED: "UNAPPLIED",
    FULLY_APPLIED: "FULLY_APPLIED",
    PARTIALLY_APPLIED: "PARTIALLY_APPLIED",
    INCONSISTENT: "INCONSISTENT",
    CHECKSUM_MISMATCH: "CHECKSUM_MISMATCH",
    MISSING_METADATA: "MISSING_METADATA"
});

function parseArgs(argv) {
    const options = { database: null, dryRun: false, diagnoseMigration003: false };

    for (const arg of argv) {
        if (arg === "--dry-run") {
            options.dryRun = true;
        } else if (arg === "--diagnose-migration-003") {
            options.diagnoseMigration003 = true;
        } else if (arg.startsWith("--database=")) {
            options.database = arg.slice("--database=".length).trim();
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return options;
}

/**
 * Split a SQL script into individual statements.
 * Handles `--` / `#` line comments, block comments, and quoted strings so a
 * semicolon inside a comment or a string does not split the statement.
 */
function splitStatements(sql) {
    const statements = [];
    let current = "";
    let state = "normal"; // normal | line-comment | block-comment | single | double | backtick

    for (let i = 0; i < sql.length; i += 1) {
        const char = sql[i];
        const next = sql[i + 1];

        if (state === "line-comment") {
            if (char === "\n") {
                state = "normal";
                current += char;
            }
            continue;
        }

        if (state === "block-comment") {
            if (char === "*" && next === "/") {
                state = "normal";
                i += 1;
            }
            continue;
        }

        if (state === "single") {
            current += char;
            if (char === "\\" && next !== undefined) {
                current += next;
                i += 1;
            } else if (char === "'") {
                state = "normal";
            }
            continue;
        }

        if (state === "double") {
            current += char;
            if (char === "\\" && next !== undefined) {
                current += next;
                i += 1;
            } else if (char === '"') {
                state = "normal";
            }
            continue;
        }

        if (state === "backtick") {
            current += char;
            if (char === "`") {
                state = "normal";
            }
            continue;
        }

        // state === normal
        if (char === "-" && next === "-") {
            state = "line-comment";
            i += 1;
            continue;
        }

        if (char === "#") {
            state = "line-comment";
            continue;
        }

        if (char === "/" && next === "*") {
            state = "block-comment";
            i += 1;
            continue;
        }

        if (char === "'") {
            state = "single";
            current += char;
            continue;
        }

        if (char === '"') {
            state = "double";
            current += char;
            continue;
        }

        if (char === "`") {
            state = "backtick";
            current += char;
            continue;
        }

        if (char === ";") {
            const trimmed = current.trim();
            if (trimmed.length > 0) {
                statements.push(trimmed);
            }
            current = "";
            continue;
        }

        current += char;
    }

    const trailing = current.trim();
    if (trailing.length > 0) {
        statements.push(trailing);
    }

    return statements;
}

function checksum(text) {
    return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32);
}

function normalizeMetadataRows(rows) {
    return rows.map((row) => Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key.toLowerCase(), value])
    ));
}

function indexesByTable(rows) {
    const indexes = new Map();
    for (const row of rows) {
        if (!indexes.has(row.table_name)) {
            indexes.set(row.table_name, new Map());
        }
        if (!indexes.get(row.table_name).has(row.index_name)) {
            indexes.get(row.table_name).set(row.index_name, []);
        }
        indexes.get(row.table_name).get(row.index_name).push(row);
    }
    return indexes;
}

function foreignKeysByName(rows) {
    return new Map(rows.map((row) => [row.constraint_name, row]));
}

function hasExpectedIndex(indexes, table, indexName, expectedColumns) {
    const tableIndexes = indexes.get(table);
    const index = tableIndexes && tableIndexes.get(indexName);
    return Boolean(
        index &&
        index.length === expectedColumns.length &&
        index.every((row, indexPosition) =>
            row.seq_in_index === indexPosition + 1 &&
            row.column_name === expectedColumns[indexPosition]
        )
    );
}

function hasExpectedForeignKey(
    foreignKeys,
    name,
    table,
    column,
    referencedTable,
    referencedColumn,
    deleteRule,
    updateRule
) {
    const foreignKey = foreignKeys.get(name);
    return Boolean(
        foreignKey &&
        foreignKey.table_name === table &&
        foreignKey.column_name === column &&
        foreignKey.referenced_column_name === referencedColumn &&
        foreignKey.referenced_table_name === referencedTable &&
        foreignKey.delete_rule === deleteRule &&
        foreignKey.update_rule === updateRule
    );
}

function isExpectedColumn(column, expected) {
    return Boolean(
        column &&
        column.column_type === expected.columnType &&
        column.is_nullable === expected.nullable &&
        column.column_default === expected.defaultValue
    );
}

function validateAuthenticationSchema(snapshot) {
    const faceColumns = new Map(
        snapshot.columns
            .filter((row) => row.table_name === "face_verifications")
            .map((row) => [row.column_name, row])
    );
    const boardingColumns = new Map(
        snapshot.columns
            .filter((row) => row.table_name === "boarding_records")
            .map((row) => [row.column_name, row])
    );
    const indexes = indexesByTable(snapshot.indexes);
    const foreignKeys = foreignKeysByName(snapshot.foreignKeys);
    const errors = [];

    if (!faceColumns.has("authentication_mode")) {
        errors.push("face_verifications.authentication_mode is missing");
    }
    if (!boardingColumns.has("authentication_mode")) {
        errors.push("boarding_records.authentication_mode is missing");
    }

    if (!isExpectedColumn(faceColumns.get("authentication_mode"), {
        columnType: "enum('RFID','CAMERA_ONLY')",
        nullable: "NO",
        defaultValue: "RFID"
    })) {
        errors.push("face_verifications.authentication_mode definition is incorrect");
    }
    if (!isExpectedColumn(boardingColumns.get("authentication_mode"), {
        columnType: "enum('RFID','CAMERA_ONLY')",
        nullable: "NO",
        defaultValue: "RFID"
    })) {
        errors.push("boarding_records.authentication_mode definition is incorrect");
    }
    if (!isExpectedColumn(faceColumns.get("rfid_card_id"), {
        columnType: "int",
        nullable: "YES",
        defaultValue: null
    })) {
        errors.push("face_verifications.rfid_card_id is not nullable INT");
    }
    if (!isExpectedColumn(boardingColumns.get("boarding_type"), {
        columnType: "enum('NORMAL','RESCUE','FEST')",
        nullable: "NO",
        defaultValue: "NORMAL"
    })) {
        errors.push("boarding_records.boarding_type was changed");
    }

    const expectedIndexes = [
        ["face_verifications", "fk_facever_card", ["rfid_card_id"]],
        ["face_verifications", "idx_facever_device", ["device_id", "created_at"]],
        ["boarding_records", "fk_boarding_rfid", ["rfid_card_id"]],
        ["boarding_records", "fk_boarding_device", ["device_id"]],
        ["boarding_records", "fk_boarding_facever", ["face_verification_id"]]
    ];
    for (const [table, indexName, columns] of expectedIndexes) {
        if (!hasExpectedIndex(indexes, table, indexName, columns)) {
            errors.push(`${table}.${indexName} index is missing or incorrect`);
        }
    }

    const expectedForeignKeys = [
        ["fk_facever_card", "face_verifications", "rfid_card_id", "rfid_cards", "id", "RESTRICT", "CASCADE"],
        ["fk_boarding_rfid", "boarding_records", "rfid_card_id", "rfid_cards", "id", "SET NULL", "CASCADE"],
        ["fk_boarding_device", "boarding_records", "device_id", "devices", "id", "SET NULL", "CASCADE"],
        ["fk_boarding_facever", "boarding_records", "face_verification_id", "face_verifications", "id", "SET NULL", "CASCADE"]
    ];
    for (const foreignKey of expectedForeignKeys) {
        if (!hasExpectedForeignKey(foreignKeys, ...foreignKey)) {
            errors.push(`${foreignKey[0]} foreign key is missing or incorrect`);
        }
    }

    return errors;
}

function validateStableSchema(snapshot, faceCardNullable) {
    const faceCard = snapshot.columns.find(
        (row) => row.table_name === "face_verifications" && row.column_name === "rfid_card_id"
    );
    const boardingType = snapshot.columns.find(
        (row) => row.table_name === "boarding_records" && row.column_name === "boarding_type"
    );
    const indexes = indexesByTable(snapshot.indexes);
    const foreignKeys = foreignKeysByName(snapshot.foreignKeys);
    const errors = [];

    if (!isExpectedColumn(faceCard, {
        columnType: "int",
        nullable: faceCardNullable ? "YES" : "NO",
        defaultValue: null
    })) {
        errors.push(`face_verifications.rfid_card_id is not the expected ${faceCardNullable ? "nullable" : "non-nullable"} INT`);
    }
    if (!isExpectedColumn(boardingType, {
        columnType: "enum('NORMAL','RESCUE','FEST')",
        nullable: "NO",
        defaultValue: "NORMAL"
    })) {
        errors.push("boarding_records.boarding_type is missing or changed");
    }

    const expectedIndexes = [
        ["face_verifications", "fk_facever_card", ["rfid_card_id"]],
        ["face_verifications", "idx_facever_device", ["device_id", "created_at"]],
        ["boarding_records", "fk_boarding_rfid", ["rfid_card_id"]],
        ["boarding_records", "fk_boarding_device", ["device_id"]],
        ["boarding_records", "fk_boarding_facever", ["face_verification_id"]]
    ];
    for (const [table, indexName, columns] of expectedIndexes) {
        if (!hasExpectedIndex(indexes, table, indexName, columns)) {
            errors.push(`${table}.${indexName} index is missing or incorrect`);
        }
    }

    const expectedForeignKeys = [
        ["fk_facever_card", "face_verifications", "rfid_card_id", "rfid_cards", "id", "RESTRICT", "CASCADE"],
        ["fk_boarding_rfid", "boarding_records", "rfid_card_id", "rfid_cards", "id", "SET NULL", "CASCADE"],
        ["fk_boarding_device", "boarding_records", "device_id", "devices", "id", "SET NULL", "CASCADE"],
        ["fk_boarding_facever", "boarding_records", "face_verification_id", "face_verifications", "id", "SET NULL", "CASCADE"]
    ];
    for (const foreignKey of expectedForeignKeys) {
        if (!hasExpectedForeignKey(foreignKeys, ...foreignKey)) {
            errors.push(`${foreignKey[0]} foreign key is missing or incorrect`);
        }
    }
    return errors;
}

function classifyMigration003(snapshot, expectedChecksum) {
    const faceHasMode = snapshot.columns.some(
        (row) => row.table_name === "face_verifications" && row.column_name === "authentication_mode"
    );
    const boardingHasMode = snapshot.columns.some(
        (row) => row.table_name === "boarding_records" && row.column_name === "authentication_mode"
    );
    const migrationMetadata = snapshot.appliedChecksum;

    if (faceHasMode !== boardingHasMode) {
        return {
            state: MIGRATION_STATES.PARTIALLY_APPLIED,
            errors: ["Exactly one authentication_mode column exists"]
        };
    }

    if (!faceHasMode && !boardingHasMode) {
        const preflightErrors = validateStableSchema(snapshot, false);
        if (migrationMetadata) {
            preflightErrors.push("schema_migrations records migration 003 but its columns are absent");
        }
        return preflightErrors.length === 0
            ? { state: MIGRATION_STATES.UNAPPLIED, errors: [] }
            : { state: MIGRATION_STATES.INCONSISTENT, errors: preflightErrors };
    }

    const errors = [
        ...validateStableSchema(snapshot, true),
        ...validateAuthenticationSchema(snapshot)
    ];
    if (errors.length > 0) {
        return { state: MIGRATION_STATES.INCONSISTENT, errors };
    }
    if (!migrationMetadata) {
        return {
            state: MIGRATION_STATES.MISSING_METADATA,
            errors: ["Schema matches migration 003 but schema_migrations has no matching row"]
        };
    }
    if (migrationMetadata !== expectedChecksum) {
        return {
            state: MIGRATION_STATES.CHECKSUM_MISMATCH,
            errors: [`Recorded checksum ${migrationMetadata} does not match ${expectedChecksum}`]
        };
    }
    return { state: MIGRATION_STATES.FULLY_APPLIED, errors: [] };
}

async function tableExists(connection, database, table) {
    const [rows] = await connection.query(
        `SELECT 1
           FROM information_schema.tables
          WHERE table_schema = ? AND table_name = ?
          LIMIT 1`,
        [database, table]
    );

    return rows.length > 0;
}

async function loadMigration003Snapshot(connection, database, appliedChecksum) {
    const [columnRows] = await connection.query(
        `SELECT table_name, column_name, column_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = ?
            AND table_name IN ('face_verifications', 'boarding_records')`,
        [database]
    );
    const [indexRows] = await connection.query(
        `SELECT table_name, index_name, seq_in_index, column_name
           FROM information_schema.statistics
          WHERE table_schema = ?
            AND table_name IN ('face_verifications', 'boarding_records')
          ORDER BY table_name, index_name, seq_in_index`,
        [database]
    );
    const [foreignKeyRows] = await connection.query(
        `SELECT kcu.constraint_name, kcu.table_name, kcu.column_name,
                kcu.referenced_table_name, kcu.referenced_column_name,
                rc.delete_rule, rc.update_rule
           FROM information_schema.key_column_usage kcu
           JOIN information_schema.referential_constraints rc
             ON rc.constraint_schema = kcu.constraint_schema
            AND rc.constraint_name = kcu.constraint_name
            AND rc.table_name = kcu.table_name
          WHERE kcu.constraint_schema = ?
            AND kcu.table_name IN ('face_verifications', 'boarding_records')
            AND kcu.referenced_table_name IS NOT NULL`,
        [database]
    );
    return {
        columns: normalizeMetadataRows(columnRows),
        indexes: normalizeMetadataRows(indexRows),
        foreignKeys: normalizeMetadataRows(foreignKeyRows),
        appliedChecksum
    };
}

function diagnosticRowSample(rows, properties) {
    return rows.slice(0, 3).map((row) => {
        const sample = {};
        for (const property of properties) {
            sample[property] = row[property];
        }
        return sample;
    });
}

async function diagnoseMigration003(connection, database, logger = console) {
    const [identityRows] = await connection.query(
        `SELECT DATABASE() AS selected_database,
                @@hostname AS server_hostname,
                @@port AS server_port,
                CURRENT_USER() AS authenticated_account,
                USER() AS client_account`
    );
    const snapshot = await loadMigration003Snapshot(connection, database, null);
    const identity = identityRows[0] || {};

    logger.log("Migration 003 diagnostic (read-only)");
    logger.log("Identity fields:", Object.keys(identityRows[0] || {}));
    logger.log("Identity:", {
        selected_database: identity.selected_database,
        server_hostname: identity.server_hostname,
        server_port: identity.server_port,
        authenticated_account: identity.authenticated_account,
        client_account: identity.client_account
    });
    logger.log("Columns row count:", snapshot.columns.length);
    logger.log("Columns fields:", Object.keys(snapshot.columns[0] || {}));
    logger.log("Columns samples:", diagnosticRowSample(snapshot.columns, [
        "table_name",
        "column_name",
        "column_type",
        "is_nullable",
        "column_default"
    ]));
    logger.log("Indexes row count:", snapshot.indexes.length);
    logger.log("Indexes fields:", Object.keys(snapshot.indexes[0] || {}));
    logger.log("Indexes samples:", snapshot.indexes.slice(0, 3).map((row) => ({
        table_name: row.table_name,
        index_name: row.index_name,
        seq_in_index: row.seq_in_index,
        seq_in_index_type: typeof row.seq_in_index,
        column_name: row.column_name
    })));
    logger.log("Foreign keys row count:", snapshot.foreignKeys.length);
    logger.log("Foreign key fields:", Object.keys(snapshot.foreignKeys[0] || {}));
    logger.log("Foreign key samples:", diagnosticRowSample(snapshot.foreignKeys, [
        "constraint_name",
        "table_name",
        "column_name",
        "referenced_table_name",
        "referenced_column_name",
        "delete_rule",
        "update_rule"
    ]));
}

async function getAppliedMigrations(connection, database, allowCreate) {
    const exists = await tableExists(connection, database, "schema_migrations");
    if (!exists) {
        if (!allowCreate) {
            return new Map();
        }
        const [tables] = await connection.query(
            `SELECT table_name
               FROM information_schema.tables
              WHERE table_schema = ?`,
            [database]
        );
        if (tables.length > 0) {
            throw new Error(
                "schema_migrations is absent in a non-empty database; migration history cannot be reconciled automatically"
            );
        }
        await connection.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                migration_id VARCHAR(120) PRIMARY KEY,
                checksum CHAR(32) NOT NULL,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    }
    const [rows] = await connection.query(
        "SELECT migration_id, checksum FROM schema_migrations"
    );
    return new Map(rows.map((row) => [row.migration_id, row.checksum]));
}

function assertMigration003State(result, migrationId) {
    if (result.state !== MIGRATION_STATES.UNAPPLIED &&
        result.state !== MIGRATION_STATES.FULLY_APPLIED) {
        throw new Error(
            `${migrationId} schema state is ${result.state}: ${result.errors.join("; ")}`
        );
    }
}

async function verifyMigration003AfterApply(connection, database, expectedChecksum) {
    try {
        const snapshot = await loadMigration003Snapshot(
            connection,
            database,
            expectedChecksum
        );
        const result = classifyMigration003(snapshot, expectedChecksum);
        assertMigration003State(result, MIGRATION_003);
        if (result.state !== MIGRATION_STATES.FULLY_APPLIED) {
            throw new Error(`expected FULLY_APPLIED, received ${result.state}`);
        }
    } catch (error) {
        throw new Error(
            `${MIGRATION_003} post-migration schema validation failed; ` +
            "DDL may already have partially or fully changed the schema and manual inspection is required: " +
            error.message
        );
    }
}

async function closeConnection(connection, primaryError) {
    try {
        await connection.end();
    } catch (cleanupError) {
        if (!primaryError) {
            throw cleanupError;
        }
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const database = options.database || process.env.DB_NAME;

    if (!database) {
        throw new Error("No database selected. Set DB_NAME in backend/.env or pass --database=NAME.");
    }

    let connection;
    let primaryError;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database,
            multipleStatements: false
        });

        console.log(`Target database : ${database}`);
        console.log(`Migrations      : ${MIGRATIONS_DIR}`);

        if (options.diagnoseMigration003) {
            await diagnoseMigration003(connection, database);
            return;
        }

        const applied = await getAppliedMigrations(connection, database, !options.dryRun);

        const files = fs
            .readdirSync(MIGRATIONS_DIR)
            .filter((name) => name.endsWith(".sql"))
            .sort();

        if (files.length === 0) {
            console.log("No migration files found.");
            return;
        }

        let pending = 0;

        for (const file of files) {
            const migrationId = file.replace(/\.sql$/, "");
            const filePath = path.join(MIGRATIONS_DIR, file);
            const sql = fs.readFileSync(filePath, "utf8");
            const sum = checksum(sql);

            if (applied.has(migrationId)) {
                if (applied.get(migrationId) !== sum) {
                    throw new Error(
                        `${migrationId} checksum mismatch: recorded ${applied.get(migrationId)}, current ${sum}`
                    );
                }
                console.log(`= ${migrationId} already applied`);
                if (migrationId === MIGRATION_003) {
                    const snapshot = await loadMigration003Snapshot(
                        connection,
                        database,
                        applied.get(migrationId)
                    );
                    assertMigration003State(classifyMigration003(snapshot, sum), migrationId);
                }
                continue;
            }

            const statements = splitStatements(sql);

            if (migrationId === MIGRATION_003) {
                const snapshot = await loadMigration003Snapshot(connection, database, null);
                const result = classifyMigration003(snapshot, sum);
                assertMigration003State(result, migrationId);
                if (result.state === MIGRATION_STATES.FULLY_APPLIED) {
                    throw new Error(
                        `${migrationId} is fully applied but its schema_migrations row is missing`
                    );
                }
            }

            if (options.dryRun) {
                console.log(`~ ${migrationId}: ${statements.length} statements pending (dry run)`);
                pending += 1;
                continue;
            }

            console.log(`> applying ${migrationId} (${statements.length} statements)`);

            for (let index = 0; index < statements.length; index += 1) {
                const statement = statements[index];
                const preview = statement.replace(/\s+/g, " ").slice(0, 90);
                try {
                    await connection.query(statement);
                } catch (error) {
                    console.error(`\nFAILED in ${migrationId} at statement ${index + 1}:`);
                    console.error(`  ${preview}...`);
                    console.error(`  ${error.code || error.name}: ${error.message}`);
                    throw error;
                }
            }

            if (migrationId === MIGRATION_003) {
                await verifyMigration003AfterApply(connection, database, sum);
            }

            await connection.query(
                "INSERT INTO schema_migrations (migration_id, checksum) VALUES (?, ?)",
                [migrationId, sum]
            );

            pending += 1;
            console.log(`  done`);
        }

        console.log(
            options.dryRun
                ? `\n${pending} migration(s) pending.`
                : `\n${pending} migration(s) applied, ${applied.size} already present.`
        );
    } catch (error) {
        primaryError = error;
        throw error;
    } finally {
        if (connection) {
            await closeConnection(connection, primaryError);
        }
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`Migration failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    MIGRATION_STATES,
    checksum,
    classifyMigration003,
    validateAuthenticationSchema,
    parseArgs,
    getAppliedMigrations,
    loadMigration003Snapshot,
    assertMigration003State,
    verifyMigration003AfterApply,
    closeConnection,
    diagnoseMigration003
};
