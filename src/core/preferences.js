import { ANY } from "./constants.js";

function isLive(rule, now) {
  if (!rule.muted || !rule.mutedUntil) return true;
  return new Date(rule.mutedUntil).getTime() > now;
}

function specificity(rule) {
  return (rule.app !== ANY ? 4 : 0) + (rule.category !== ANY ? 2 : 0) + (rule.type !== ANY ? 1 : 0);
}

// Client mirror of notify.is_muted(): the most specific live rule wins.
export function resolveMuted(preferences, { app = ANY, category = ANY, type = ANY } = {}, now = Date.now()) {
  const matches = (preferences || []).filter(
    (rule) =>
      [ANY, app].includes(rule.app) &&
      [ANY, category].includes(rule.category) &&
      [ANY, type].includes(rule.type) &&
      isLive(rule, now),
  );
  if (!matches.length) return false;
  matches.sort((a, b) => specificity(b) - specificity(a));
  return matches[0].muted;
}

// The exact rule for a scope (no wildcard fallback), or null.
export function findRule(preferences, { app = ANY, category = ANY, type = ANY } = {}) {
  return (preferences || []).find((rule) => rule.app === app && rule.category === category && rule.type === type) || null;
}

// Whether one rule mutes right now: it is a mute and its snooze (mutedUntil) hasn't passed.
export function isRuleMuted(rule, now = Date.now()) {
  return Boolean(rule && rule.muted && isLive(rule, now));
}
