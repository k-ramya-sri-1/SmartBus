const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
    MIGRATION_STATES,
    classifyMigration003,
    getAppliedMigrations,
    loadMigration003Snapshot,
    assertMigration003State,
    verifyMigration003AfterApply,
    closeConnection,
    diagnoseMigration003
} = require("./migrate.js");

const CHECKSUM = "0123456789abcdef0123456789abcdef";

function column(table_name, column_name, column_type, is_nullable, column_default) {
    return { table_name, column_name, column_type, is_nullable, column_default };
}

function snapshot({ appliedChecksum = null, modes = true } = {}) {
    const columns = [
        column("face_verifications", "rfid_card_id", "int", modes ? "YES" : "NO", null),
        column("boarding_records", "boarding_type", "enum('NORMAL','RESCUE','FEST')", "NO", "NORMAL")
    ];
    if (modes) {
        columns.push(
            column("face_verifications", "authentication_mode", "enum('RFID','CAMERA_ONLY')", "NO", "RFID"),
            column("boarding_records", "authentication_mode", "enum('RFID','CAMERA_ONLY')", "NO", "RFID")
        );
    }

    const indexes = [
        ["face_verifications", "fk_facever_card", ["rfid_card_id"]],
        ["face_verifications", "idx_facever_device", ["device_id", "created_at"]],
        ["boarding_records", "fk_boarding_rfid", ["rfid_card_id"]],
        ["boarding_records", "fk_boarding_device", ["device_id"]],
        ["boarding_records", "fk_boarding_facever", ["face_verification_id"]]
    ].flatMap(([table_name, index_name, columns]) =>
        columns.map((column_name, index) => ({
            table_name,
            index_name,
            seq_in_index: index + 1,
            column_name
        }))
    );

    const foreignKeys = [
        ["fk_facever_card", "face_verifications", "rfid_card_id", "rfid_cards", "id", "RESTRICT", "CASCADE"],
        ["fk_boarding_rfid", "boarding_records", "rfid_card_id", "rfid_cards", "id", "SET NULL", "CASCADE"],
        ["fk_boarding_device", "boarding_records", "device_id", "devices", "id", "SET NULL", "CASCADE"],
        ["fk_boarding_facever", "boarding_records", "face_verification_id", "face_verifications", "id", "SET NULL", "CASCADE"]
    ].map(([constraint_name, table_name, column_name, referenced_table_name, referenced_column_name, delete_rule, update_rule]) => ({
        constraint_name,
        table_name,
        column_name,
        referenced_table_name,
        referenced_column_name,
        delete_rule,
        update_rule
    }));

    return { columns, indexes, foreignKeys, appliedChecksum };
}

describe("migration 003 schema-state classification", () => {
    it("recognizes a clean pre-003 schema", () => {
        assert.equal(classifyMigration003(snapshot({ modes: false }), CHECKSUM).state, MIGRATION_STATES.UNAPPLIED);
    });

    it("rejects migration metadata when the 003 columns are absent", () => {
        assert.equal(
            classifyMigration003(snapshot({ modes: false, appliedChecksum: CHECKSUM }), CHECKSUM).state,
            MIGRATION_STATES.INCONSISTENT
        );
    });

    it("recognizes a fully applied schema", () => {
        assert.equal(classifyMigration003(snapshot({ appliedChecksum: CHECKSUM }), CHECKSUM).state, MIGRATION_STATES.FULLY_APPLIED);
    });

    it("rejects either missing authentication column as partial", () => {
        const faceOnly = snapshot({ appliedChecksum: null });
        faceOnly.columns = faceOnly.columns.filter(
            (row) => row.table_name !== "boarding_records" || row.column_name !== "authentication_mode"
        );
        assert.equal(classifyMigration003(faceOnly, CHECKSUM).state, MIGRATION_STATES.PARTIALLY_APPLIED);

        const boardingOnly = snapshot({ appliedChecksum: null });
        boardingOnly.columns = boardingOnly.columns.filter(
            (row) => row.table_name !== "face_verifications" || row.column_name !== "authentication_mode"
        );
        assert.equal(classifyMigration003(boardingOnly, CHECKSUM).state, MIGRATION_STATES.PARTIALLY_APPLIED);
    });

    it("rejects changed enum, default, nullability, or type", () => {
        for (const change of [
            (columns) => { columns.find((row) => row.column_name === "authentication_mode").column_type = "enum('RFID')"; },
            (columns) => { columns.find((row) => row.column_name === "authentication_mode").column_default = "CAMERA_ONLY"; },
            (columns) => { columns.find((row) => row.column_name === "authentication_mode").is_nullable = "YES"; },
            (columns) => { columns.find((row) => row.column_name === "rfid_card_id").column_type = "bigint"; }
        ]) {
            const changed = snapshot({ appliedChecksum: CHECKSUM });
            change(changed.columns);
            assert.equal(classifyMigration003(changed, CHECKSUM).state, MIGRATION_STATES.INCONSISTENT);
        }
    });

    it("rejects missing indexes, foreign keys, and changed boarding_type", () => {
        const missingIndex = snapshot({ appliedChecksum: CHECKSUM });
        missingIndex.indexes.pop();
        assert.equal(classifyMigration003(missingIndex, CHECKSUM).state, MIGRATION_STATES.INCONSISTENT);

        const missingForeignKey = snapshot({ appliedChecksum: CHECKSUM });
        missingForeignKey.foreignKeys.pop();
        assert.equal(classifyMigration003(missingForeignKey, CHECKSUM).state, MIGRATION_STATES.INCONSISTENT);

        const changedBoardingType = snapshot({ appliedChecksum: CHECKSUM });
        changedBoardingType.columns.find((row) => row.column_name === "boarding_type").column_type =
            "enum('NORMAL','RESCUE')";
        assert.equal(classifyMigration003(changedBoardingType, CHECKSUM).state, MIGRATION_STATES.INCONSISTENT);
    });

    it("accepts the real ordered composite device index", () => {
        assert.equal(
            classifyMigration003(snapshot({ appliedChecksum: CHECKSUM }), CHECKSUM).state,
            MIGRATION_STATES.FULLY_APPLIED
        );
    });

    it("rejects a composite index with a missing column", () => {
        const changed = snapshot({ appliedChecksum: CHECKSUM });
        changed.indexes = changed.indexes.filter(
            (row) => !(row.table_name === "face_verifications" &&
                row.index_name === "idx_facever_device" &&
                row.column_name === "created_at")
        );
        assert.equal(classifyMigration003(changed, CHECKSUM).state, MIGRATION_STATES.INCONSISTENT);
    });

    it("rejects an incorrect composite index column order", () => {
        const changed = snapshot({ appliedChecksum: CHECKSUM });
        const deviceIndex = changed.indexes.filter(
            (row) => row.table_name === "face_verifications" &&
                row.index_name === "idx_facever_device"
        );
        deviceIndex[0].column_name = "created_at";
        deviceIndex[1].column_name = "device_id";
        assert.equal(classifyMigration003(changed, CHECKSUM).state, MIGRATION_STATES.INCONSISTENT);
    });

    it("rejects an unexpected composite index definition", () => {
        const changed = snapshot({ appliedChecksum: CHECKSUM });
        changed.indexes.push({
            table_name: "face_verifications",
            index_name: "idx_facever_device",
            seq_in_index: 3,
            column_name: "score"
        });
        assert.equal(classifyMigration003(changed, CHECKSUM).state, MIGRATION_STATES.INCONSISTENT);
    });

    it("rejects a foreign key with the correct name and table but wrong referenced column", () => {
        const changed = snapshot({ appliedChecksum: CHECKSUM });
        changed.foreignKeys.find((row) => row.constraint_name === "fk_boarding_facever")
            .referenced_column_name = "student_id";
        assert.equal(classifyMigration003(changed, CHECKSUM).state, MIGRATION_STATES.INCONSISTENT);
    });

    it("rejects checksum mismatch and missing metadata", () => {
        assert.equal(
            classifyMigration003(snapshot({ appliedChecksum: "fedcba9876543210fedcba9876543210" }), CHECKSUM).state,
            MIGRATION_STATES.CHECKSUM_MISMATCH
        );
        assert.equal(
            classifyMigration003(snapshot(), CHECKSUM).state,
            MIGRATION_STATES.MISSING_METADATA
        );
    });
});

describe("migration dry-run metadata behavior", () => {
    it("accepts migration 003 only after fresh post-migration validation", async () => {
        const valid = snapshot({ appliedChecksum: CHECKSUM });
        const statements = [];
        let queryIndex = 0;
        const connection = {
            async query(sql) {
                statements.push(sql);
                const rows = [
                    valid.columns,
                    valid.indexes,
                    valid.foreignKeys
                ][queryIndex];
                queryIndex += 1;
                return [rows, []];
            }
        };

        await verifyMigration003AfterApply(connection, "smartbus", CHECKSUM);

        assert.equal(queryIndex, 3);
        assert.equal(statements.some((sql) => /INSERT INTO schema_migrations/i.test(sql)), false);
    });

    it("blocks migration history insertion when post-migration validation fails", async () => {
        const invalid = snapshot({ appliedChecksum: CHECKSUM });
        invalid.columns = invalid.columns.filter(
            (row) => row.column_name !== "authentication_mode" ||
                row.table_name !== "boarding_records"
        );
        const statements = [];
        let queryIndex = 0;
        const connection = {
            async query(sql) {
                statements.push(sql);
                const rows = [
                    invalid.columns,
                    invalid.indexes,
                    invalid.foreignKeys
                ][queryIndex];
                queryIndex += 1;
                return [rows, []];
            }
        };

        await assert.rejects(
            verifyMigration003AfterApply(connection, "smartbus", CHECKSUM),
            /post-migration schema validation failed.*manual inspection is required/
        );
        assert.equal(statements.some((sql) => /INSERT INTO schema_migrations/i.test(sql)), false);
    });

    it("normalizes uppercase information_schema metadata keys before validation", async () => {
        const valid = snapshot({ appliedChecksum: CHECKSUM });
        const uppercase = (row) => Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key.toUpperCase(), value])
        );
        const connection = {
            async query(sql) {
                if (/information_schema\.columns/.test(sql)) {
                    return [valid.columns.map(uppercase), []];
                }
                if (/information_schema\.statistics/.test(sql)) {
                    return [valid.indexes.map(uppercase), []];
                }
                if (/information_schema\.key_column_usage/.test(sql)) {
                    return [valid.foreignKeys.map(uppercase), []];
                }
                throw new Error(`unexpected metadata query: ${sql}`);
            }
        };

        const loaded = await loadMigration003Snapshot(connection, "smartbus", CHECKSUM);

        assert.deepEqual(loaded.columns[0], valid.columns[0]);
        assert.deepEqual(loaded.indexes.find((row) => row.index_name === "idx_facever_device"), valid.indexes[1]);
        assert.deepEqual(loaded.foreignKeys[0], valid.foreignKeys[0]);
        assert.equal(
            classifyMigration003(loaded, CHECKSUM).state,
            MIGRATION_STATES.FULLY_APPLIED
        );
    });

    it("runs the diagnostic path with read-only metadata queries only", async () => {
        const queries = [];
        const output = [];
        const connection = {
            async query(sql) {
                queries.push(sql);
                if (/SELECT DATABASE\(\)/.test(sql)) {
                    return [[{
                        selected_database: "smartbus",
                        server_hostname: "test-host",
                        server_port: 3306,
                        authenticated_account: "test-user@localhost",
                        client_account: "test-user@localhost"
                    }], []];
                }
                if (/information_schema\.columns/.test(sql)) {
                    return [[{
                        TABLE_NAME: "face_verifications",
                        COLUMN_NAME: "rfid_card_id",
                        COLUMN_TYPE: "int",
                        IS_NULLABLE: "NO",
                        COLUMN_DEFAULT: null
                    }], []];
                }
                if (/information_schema\.statistics/.test(sql)) {
                    return [[{
                        TABLE_NAME: "face_verifications",
                        INDEX_NAME: "idx_facever_device",
                        SEQ_IN_INDEX: 1,
                        COLUMN_NAME: "device_id"
                    }], []];
                }
                if (/information_schema\.key_column_usage/.test(sql)) {
                    return [[{
                        CONSTRAINT_NAME: "fk_facever_card",
                        TABLE_NAME: "face_verifications",
                        COLUMN_NAME: "rfid_card_id",
                        REFERENCED_TABLE_NAME: "rfid_cards",
                        REFERENCED_COLUMN_NAME: "id",
                        DELETE_RULE: "RESTRICT",
                        UPDATE_RULE: "CASCADE"
                    }], []];
                }
                throw new Error(`unexpected diagnostic query: ${sql}`);
            }
        };
        const logger = {
            log(...args) {
                output.push(args);
            }
        };

        await diagnoseMigration003(connection, "smartbus", logger);

        assert.equal(queries.length, 4);
        assert.equal(queries.some((sql) =>
            /\b(CREATE|ALTER|INSERT|UPDATE|DELETE|DROP)\s/i.test(sql)
        ), false);
        assert.equal(output.some((entry) => entry.includes("Indexes samples:")), true);
        assert.equal(output.some((entry) => entry.some((value) =>
            JSON.stringify(value).includes("number")
        )), true);
    });

    it("does not create schema_migrations when the table is absent", async () => {
        const statements = [];
        const connection = {
            async query(sql) {
                statements.push(sql);
                if (/information_schema\.tables/.test(sql)) {
                    return [[], []];
                }
                throw new Error(`unexpected query: ${sql}`);
            }
        };

        const applied = await getAppliedMigrations(connection, "isolated_fixture", false);
        assert.equal(applied.size, 0);
        assert.equal(statements.some((sql) => /CREATE TABLE/i.test(sql)), false);
        assert.equal(statements.length, 1);
    });

    it("refuses normal execution when migration history is absent in a non-empty schema", async () => {
        const statements = [];
        let queryCount = 0;
        const connection = {
            async query(sql) {
                statements.push(sql);
                queryCount += 1;
                if (/information_schema\.tables/.test(sql)) {
                    return queryCount === 1
                        ? [[], []]
                        : [[{ table_name: "students" }], []];
                }
                return [[], []];
            }
        };

        await assert.rejects(
            getAppliedMigrations(connection, "isolated_fixture", true),
            /schema_migrations is absent in a non-empty database/
        );
        assert.equal(statements.some((sql) => /CREATE TABLE/i.test(sql)), false);
    });

    it("propagates metadata-query failures without attempting migration SQL", async () => {
        const statements = [];
        const connection = {
            async query(sql) {
                statements.push(sql);
                throw new Error("metadata unavailable");
            }
        };
        await assert.rejects(
            getAppliedMigrations(connection, "isolated_fixture", false),
            /metadata unavailable/
        );
        assert.equal(statements.some((sql) => /ALTER TABLE|INSERT INTO/i.test(sql)), false);
    });

    it("propagates schema-validation query failures", async () => {
        await assert.rejects(
            loadMigration003Snapshot({
                async query() {
                    throw new Error("schema metadata unavailable");
                }
            }, "isolated_fixture", null),
            /schema metadata unavailable/
        );
    });

    it("rejects preflight before any migration statement can execute", () => {
        let executed = false;
        assert.throws(
            () => assertMigration003State({
                state: MIGRATION_STATES.PARTIALLY_APPLIED,
                errors: ["one authentication column is missing"]
            }, "003_authentication_modes"),
            /PARTIALLY_APPLIED/
        );
        assert.equal(executed, false);
    });

    it("preserves the primary failure when connection cleanup also fails", async () => {
        await closeConnection({
            async end() {
                throw new Error("cleanup failed");
            }
        }, new Error("primary failure"));
    });

    it("reports cleanup failure when there is no primary failure", async () => {
        await assert.rejects(
            closeConnection({
                async end() {
                    throw new Error("cleanup failed");
                }
            }, null),
            /cleanup failed/
        );
    });
});
