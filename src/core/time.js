const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

// Accepts milliseconds or a compact string ("30m", "12h", "7d", "2w"); null when unparseable.
export function parseDuration(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([smhdw])\s*$/i.exec(String(value ?? ""));
  return match ? Number(match[1]) * UNIT_MS[match[2].toLowerCase()] : null;
}

function toDate(value) {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// An explicit expiresAt wins over a relative expiresIn; returns an ISO string or null.
export function resolveExpiresAt({ expiresAt, expiresIn } = {}, now = Date.now()) {
  const absolute = toDate(expiresAt);
  if (absolute) return absolute.toISOString();
  const ms = parseDuration(expiresIn);
  return ms ? new Date(now + ms).toISOString() : null;
}

// Compact feed timestamp: "now", "5m", "3h", "2d", then a short date.
export function formatRelativeTime(value, now = Date.now()) {
  const date = toDate(value);
  if (!date) return "";
  const diff = Math.max(0, now - date.getTime());
  if (diff < 45_000) return "now";
  if (diff < UNIT_MS.h) return `${Math.round(diff / UNIT_MS.m)}m`;
  if (diff < UNIT_MS.d) return `${Math.round(diff / UNIT_MS.h)}h`;
  if (diff < UNIT_MS.w) return `${Math.round(diff / UNIT_MS.d)}d`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}

export function formatFullTime(value) {
  const date = toDate(value);
  return date ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
}

// Feed section a timestamp falls into, relative to local midnight.
export function dayBucket(value, now = Date.now()) {
  const date = toDate(value);
  if (!date) return "Earlier";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = today.getTime();
  const time = date.getTime();
  if (time >= start) return "Today";
  if (time >= start - UNIT_MS.d) return "Yesterday";
  if (time >= start - 6 * UNIT_MS.d) return "This week";
  return "Earlier";
}
