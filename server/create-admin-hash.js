const crypto = require("node:crypto");
const readline = require("node:readline/promises");

async function main() {
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const password = await terminal.question("Choose an admin password (at least 12 characters): ");
        const confirmation = await terminal.question("Confirm password: ");
        if (password.length < 12) throw new Error("Password must contain at least 12 characters.");
        if (password !== confirmation) throw new Error("Passwords do not match.");

        const salt = crypto.randomBytes(16);
        const hash = crypto.scryptSync(password, salt, 64);
        console.log(`\nADMIN_PASSWORD_HASH=${salt.toString("hex")}:${hash.toString("hex")}`);
        console.log(`SESSION_SECRET=${crypto.randomBytes(48).toString("base64url")}`);
        console.log("\nCopy these two values to your server environment; do not commit them.");
    } finally {
        terminal.close();
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
