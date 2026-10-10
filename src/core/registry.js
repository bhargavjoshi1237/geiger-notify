// Type presets: an app declares each notification it sends once, then sends by key.
// Any preset field may be a value or a function of (data, input).

const PRESET_FIELDS = [
  "category",
  "title",
  "body",
  "url",
  "icon",
  "imageUrl",
  "tone",
  "priority",
  "actions",
  "groupKey",
  "dedupeKey",
  "onConflict",
  "resurface",
  "includeActor",
  "expiresIn",
  "expiresAt",
  "to",
];

export function defineNotificationTypes(types) {
  if (!types || typeof types !== "object" || Array.isArray(types)) {
    throw new TypeError("defineNotificationTypes: expected an object keyed by type");
  }
  const out = {};
  for (const [key, preset] of Object.entries(types)) {
    if (!preset || typeof preset !== "object") {
      throw new TypeError(`defineNotificationTypes: "${key}" must be an object`);
    }
    const unknown = Object.keys(preset).filter((field) => !PRESET_FIELDS.includes(field));
    if (unknown.length) {
      throw new TypeError(`defineNotificationTypes: "${key}" has unknown field(s) ${unknown.join(", ")}`);
    }
    out[key] = Object.freeze({ ...preset });
  }
  return Object.freeze(out);
}

// Resolves a preset against send input; explicit input fields always win.
export function applyPreset(preset, input = {}) {
  if (!preset) return { ...input };
  const data = input.data ?? input.metadata ?? {};
  const resolved = {};
  for (const field of PRESET_FIELDS) {
    if (preset[field] === undefined) continue;
    resolved[field] = typeof preset[field] === "function" ? preset[field](data, input) : preset[field];
  }
  const explicit = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  return { ...resolved, ...explicit };
}
