/**
 * Integration-test harness.
 *
 * Everything a test needs, isolated from the real deployment:
 *
 *   * a throwaway database (`smartbus_test`) rebuilt from database/schema.sql
 *   * a private face-service process on its own port, with its own template
 *     directory, so enrollments made by tests never touch real templates
 *   * the real Express app on an ephemeral port
 *
 * The harness deliberately uses the production code paths. Nothing here stubs
 * the authorization logic, because the point of these tests is to prove what
 * the real stack does.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const BACKEND_DIR = path.resolve(__dirname, "..");
const REPO_DIR = path.resolve(BACKEND_DIR, "..");

const dotenv = require(path.join(BACKEND_DIR, "node_modules", "dotenv"));
dotenv.config({ path: path.join(BACKEND_DIR, ".env"), quiet: true });

const { splitStatements } = require(path.join(REPO_DIR, "database", "sql-split.js"));

const TEST_DB = process.env.TEST_DB_NAME || "smartbus_test";

// Must be set before anything requires src/config/env.js, which caches the
// whole configuration object on first import.
process.env.DB_NAME = TEST_DB;
process.env.NODE_ENV = "test";
process.env.FACE_SERVICE_URL = `http://127.0.0.1:${8011 + (process.pid % 37)}`;

const mysql = require(path.join(BACKEND_DIR, "node_modules", "mysql2", "promise"));

let faceServiceHandle = null;
let serverHandle = null;
let poolHandle = null;

function log(...args) {
    if (process.env.HARNESS_VERBOSE) {
        console.log("[harness]", ...args);
    }
}

/**
 * Connection URI for the administrative connection. Built from the environment
 * at runtime so no credential ever appears in this file.
 */
function adminUri() {
    const user = encodeURIComponent(process.env.DB_USER || "");
    const dsnSecret = encodeURIComponent(process.env.DB_PASSWORD || "");
    return `mysql://${user}:${dsnSecret}@${process.env.DB_HOST}:${process.env.DB_PORT}/`;
}

async function adminConnection() {
    return mysql.createConnection(adminUri());
}

/**
 * Drop and rebuild the test database from the authoritative schema file, so a
 * test can never run against a structure that differs from production.
 */
async function resetDatabase() {
    const schemaPath = path.join(REPO_DIR, "database", "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");
    const rewritten = schema
        .replace(/CREATE DATABASE IF NOT EXISTS smartbus;/i, `CREATE DATABASE IF NOT EXISTS ${TEST_DB};`)
        .replace(/^USE smartbus;/m, `USE ${TEST_DB};`)
        .replace(/WHERE table_schema = 'smartbus'/g, `WHERE table_schema = '${TEST_DB}'`);

    const connection = await adminConnection();

    try {
        await connection.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
        await connection.query(`CREATE DATABASE ${TEST_DB} CHARACTER SET utf8mb4`);
        await connection.query(`USE ${TEST_DB}`);

        for (const statement of splitStatements(rewritten)) {
            // CREATE DATABASE / USE were handled above.
            if (/^CREATE DATABASE/i.test(statement) || /^USE /i.test(statement)) {
                continue;
            }

            await connection.query(statement);
        }
    } finally {
        await connection.end();
    }

    log(`database ${TEST_DB} rebuilt`);
}

function pickPort(base) {
    return base + (process.pid % 37);
}
async function waitForHealth(url, timeoutMs = 45_000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });

            if (response.ok) {
                return await response.json();
            }
        } catch {
            // not up yet
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Face service did not become healthy at ${url}`);
}

/**
 * Start an isolated face service. Its templates live in a temp directory that
 * is deleted when the suite finishes. The shared internal value is inherited
 * from the parent environment, which the harness loaded from backend/.env.
 */
async function startFaceService() {
    const url = process.env.FACE_SERVICE_URL;
    const port = Number(new URL(url).port);
    const templateDir = fs.mkdtempSync(path.join(os.tmpdir(), "smartbus-test-faces-"));

    const python = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

    const child = spawn(
        python,
        [path.join("face-service", "app.py"), "--port", String(port), "--log-level", "WARNING"],
        {
            cwd: REPO_DIR,
            env: {
                ...process.env,
                FACE_SERVICE_PORT: String(port),
                FACE_TEMPLATE_DIR: templateDir,
                FACE_MODEL_DIR: path.join(REPO_DIR, "face-service", "models"),
                PYTHONUNBUFFERED: "1"
            },
            stdio: ["ignore", "pipe", "pipe"]
        }
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
    });

    child.on("exit", (code) => {
        if (code !== 0 && code !== null) {
            log(`face service exited with ${code}: ${stderr.slice(-400)}`);
        }
    });

    let health;

    try {
        health = await waitForHealth(url);
    } catch (error) {
        child.kill();
        throw new Error(
            `${error.message}\n` +
            "Start it manually once to confirm the models are present:\n" +
            "  python face-service/download_models.py\n" +
            `stderr: ${stderr.slice(-600)}`
        );
    }

    log(`face service ready on ${url} (${health.engine}, ${health.enrolled_students} templates)`);

    faceServiceHandle = {
        url,
        templateDir,
        stop: () => new Promise((resolve) => {
            child.once("exit", () => resolve());
            child.kill();
            setTimeout(resolve, 3000);
        })
    };

    return faceServiceHandle;
}

async function startServer() {
    const { createApp } = require(path.join(BACKEND_DIR, "src", "app.js"));
    const { server } = createApp();

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    const { port } = server.address();

    serverHandle = {
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve) => server.close(resolve))
    };

    log(`api listening on ${serverHandle.url}`);

    return serverHandle;
}

function getPool() {
    if (!poolHandle) {
        poolHandle = require(path.join(BACKEND_DIR, "src", "config", "database.js"));
    }
    return poolHandle;
}

async function start() {
    if (!faceServiceHandle) {
        await resetDatabase();
        await startFaceService();
        process.env.FACE_SERVICE_URL = faceServiceHandle.url;
    }

    if (!serverHandle) {
        await startServer();
    }

    return {
        api: serverHandle.url,
        faceUrl: faceServiceHandle.url
    };
}

async function stop() {
    if (serverHandle) {
        await serverHandle.close();
        serverHandle = null;
    }

    if (poolHandle) {
        await poolHandle.end().catch(() => {});
        poolHandle = null;
    }

    if (faceServiceHandle) {
        await faceServiceHandle.stop();
        fs.rmSync(faceServiceHandle.templateDir, { recursive: true, force: true });
        faceServiceHandle = null;
    }
}

/**
 * Small fetch helper that returns the parsed body plus the status, so tests can
 * assert on both without try/catch noise.
 */
async function request(method, urlPath, { body, headers = {}, auth, device } = {}) {
    const finalHeaders = { ...headers };
    let payload;

    if (body instanceof Buffer) {
        payload = body;
        finalHeaders["Content-Type"] = finalHeaders["Content-Type"] || "image/jpeg";
    } else if (body !== undefined) {
        payload = JSON.stringify(body);
        finalHeaders["Content-Type"] = "application/json";
    }

    if (auth) {
        finalHeaders.Authorization = `Bearer ${auth}`;
    }

    if (device) {
        finalHeaders["X-Device-Id"] = device.device_uid;
        finalHeaders["X-Device-Key"] = device.device_key;
    }

    const response = await fetch(`${serverHandle.url}${urlPath}`, {
        method,
        headers: finalHeaders,
        body: payload
    });

    const text = await response.text();
    let json = null;

    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { raw: text };
    }

    return { status: response.status, body: json };
}

module.exports = {
    TEST_DB,
    BACKEND_DIR,
    REPO_DIR,
    start,
    stop,
    resetDatabase,
    getPool,
    request,
    adminUri
};
