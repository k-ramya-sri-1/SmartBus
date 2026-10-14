const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const bcrypt = require("bcrypt");
const db = require("../src/config/database");

async function main() {
    const rl = readline.createInterface({ input: stdin, output: stdout });

    try {
        const [existingAdmins] = await db.query(
            "SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1"
        );

        if (existingAdmins.length > 0) {
            console.log("An administrator already exists. No account created.");
            return;
        }

        const username = (await rl.question("Admin username: ")).trim();
        const email = (await rl.question("Admin email: ")).trim().toLowerCase();
        const password = await rl.question("Admin password (12+ characters): ");

        if (!username || !email || password.length < 12) {
            console.log("Username, email, and a password of at least 12 characters are required.");
            return;
        }

        const [existingUsers] = await db.query(
            "SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1",
            [username, email]
        );

        if (existingUsers.length > 0) {
            console.log("That username or email is already registered.");
            return;
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const [result] = await db.query(
            `INSERT INTO users (username, email, password_hash, role, status)
             VALUES (?, ?, ?, 'ADMIN', 'ACTIVE')`,
            [username, email, passwordHash]
        );

        console.log(`Administrator created successfully. User ID: ${result.insertId}`);
    } finally {
        rl.close();
        await db.end();
    }
}

main().catch((error) => {
    console.error("Administrator setup failed:", error.message);
    process.exitCode = 1;
});