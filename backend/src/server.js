/**
 * Process entry point.
 *
 * Starts the HTTP server and reports whether the optional-but-required-for-
 * access face service is reachable. Configuration problems fail here, at
 * startup, rather than at the door of a bus.
 */

const { createApp } = require("./app");
const config = require("./config/env");
const faceServiceClient = require("./services/faceServiceClient");

async function main() {
    const { server } = createApp();

    const face = await faceServiceClient.health();

    server.listen(config.port, () => {
        console.log(`SmartBus Backend running on http://localhost:${config.port}`);
        console.log(`  database      : ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.name}`);
        console.log(`  face service  : ${config.faceServiceUrl} (${face.available ? "available" : "UNAVAILABLE"})`);
        console.log(`  access policy : face token TTL ${config.faceTokenTtlSeconds}s, single use`);
        console.log(`  cors origins  : ${config.corsOrigins.join(", ")}`);

        if (!face.available) {
            console.warn(
                "  WARNING: the face service is not reachable. Every access attempt will be " +
                "denied with FACE_UNAVAILABLE until it is running."
            );
        }
    });

    let closing = false;

    const shutdown = (signal) => {
        if (closing) {
            return;
        }

        closing = true;
        console.log(`\n${signal} received, closing server...`);

        server.close(() => {
            console.log("HTTP server closed.");
            process.exit(0);
        });

        setTimeout(() => process.exit(1), 10_000).unref();
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason);
});

main().catch((error) => {
    console.error(`Cannot start SmartBus backend: ${error.message}`);
    process.exit(1);
});
