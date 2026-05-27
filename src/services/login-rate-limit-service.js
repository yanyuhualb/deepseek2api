import { config } from "../config.js";

const attempts = new Map();

function pruneExpired(entry, now) {
  entry.timestamps = entry.timestamps.filter(
    (timestamp) => now - timestamp < config.loginRateLimitWindowMs
  );

  if (entry.blockedUntil && entry.blockedUntil <= now) {
    entry.blockedUntil = 0;
  }
}

function getEntry(identifier) {
  let entry = attempts.get(identifier);
  if (!entry) {
    entry = { timestamps: [], blockedUntil: 0 };
    attempts.set(identifier, entry);
  }
  return entry;
}

export function assertLoginAllowed(identifier) {
  const now = Date.now();
  const entry = getEntry(identifier);
  pruneExpired(entry, now);

  if (entry.blockedUntil > now) {
    const retryAfterMs = entry.blockedUntil - now;
    const error = new Error("Too many login attempts. Please try again later.");
    error.code = "LOGIN_RATE_LIMIT";
    error.retryAfterMs = retryAfterMs;
    throw error;
  }
}

export function recordLoginFailure(identifier) {
  const now = Date.now();
  const entry = getEntry(identifier);
  pruneExpired(entry, now);

  entry.timestamps.push(now);

  if (entry.timestamps.length >= config.loginRateLimitMaxAttempts) {
    entry.blockedUntil = now + config.loginRateLimitBlockMs;
    entry.timestamps = [];
  }
}

export function recordLoginSuccess(identifier) {
  attempts.delete(identifier);
}

export function resolveLoginIdentifier(request, username) {
  const forwarded = request.headers["x-forwarded-for"];
  const ip = (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "")
    || request.socket?.remoteAddress
    || "unknown";
  return `${ip}:${(username ?? "").toLowerCase()}`;
}

// 周期性回收，避免长期不活跃 identifier 永久驻留
const CLEANUP_INTERVAL_MS = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [identifier, entry] of attempts) {
    pruneExpired(entry, now);
    if (entry.timestamps.length === 0 && entry.blockedUntil === 0) {
      attempts.delete(identifier);
    }
  }
}, CLEANUP_INTERVAL_MS).unref?.();
