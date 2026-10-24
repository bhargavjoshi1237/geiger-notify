// @geiger/notify core: framework-agnostic, works in the browser and on the server.
export { createNotifier } from "./core/client.js";
export { defineNotificationTypes, applyPreset } from "./core/registry.js";
export {
  NOTIFY_SCHEMA,
  TONES,
  PRIORITIES,
  VIEWS,
  ANY,
  CATEGORIES,
  SUITE_APPS,
  appInfo,
  categoryInfo,
} from "./core/constants.js";
export {
  normalizeNotification,
  normalizePreference,
  normalizeAudience,
  toSendPayload,
} from "./core/normalize.js";
export { resolveMuted, findRule, isRuleMuted } from "./core/preferences.js";
export { parseDuration, resolveExpiresAt, formatRelativeTime, formatFullTime, dayBucket } from "./core/time.js";
export { CHIME_GAP_MS, chime, unlockSound, isSoundEnabled, setSoundEnabled } from "./core/sound.js";
