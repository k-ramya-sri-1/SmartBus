/**
 * Minimal in-memory rate limiter.
 *
 * It exists to slow down credential guessing and to stop a misbehaving or
 * spoofed device from hammering the face service. It is deliberately small:
 * one process, fixed window, no dependency. For a multi-instance deployment
 * this belongs in Redis, which is noted in the documentation.
 */

function createRateLimiter({ windowMs = 60_000, max = 60, keyPrefix = "rl" } = {}) {
    const buckets = new Map();

    function sweep(now) {
        for (const [key, bucket] of buckets) {
            if (bucket.resetAt <= now) {
                buckets.delete(key);
            }
        }
    }

    return function rateLimit(req, res, next) {
        const now = Date.now();
        const identity = req.ip || req.socket?.remoteAddress || "unknown";
        const key = `${keyPrefix}:${identity}`;

        if (buckets.size > 5000) {
            sweep(now);
        }

        let bucket = buckets.get(key);

        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }

        bucket.count += 1;

        const remaining = Math.max(0, max - bucket.count);
        res.setHeader("X-RateLimit-Limit", String(max));
        res.setHeader("X-RateLimit-Remaining", String(remaining));

        if (bucket.count > max) {
            const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
            res.setHeader("Retry-After", String(retryAfter));
            return res.status(429).json({
                success: false,
                error: "RATE_LIMITED",
                message: `Too many requests. Retry in ${retryAfter} seconds.`
            });
        }

        return next();
    };
}

module.exports = { createRateLimiter };
