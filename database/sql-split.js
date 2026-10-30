/**
 * Split a SQL script into individual statements.
 *
 * Handles `--` / `#` line comments, block comments, quoted strings and quoted
 * identifiers, so a semicolon inside a comment or a string literal never splits
 * a statement in half.
 *
 * Shared by the migration runner and by the test harness, which rebuilds the
 * test database from database/schema.sql.
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

module.exports = { splitStatements };
