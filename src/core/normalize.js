// snake_case rows ↔ camelCase view models for the notify schema.

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// One inbox row (delivery joined with its notification) → view model.
export function normalizeNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    notificationId: row.notification_id ?? null,
    userId: row.user_id ?? null,
    app: row.app ?? "",
    category: row.category ?? "general",
    type: row.type ?? "general",
    title: row.title ?? "",
    body: row.body ?? "",
    url: row.url ?? "",
    icon: row.icon ?? "",
    imageUrl: row.image_url ?? "",
    tone: row.tone ?? "neutral",
    priority: row.priority ?? "normal",
    audience: row.audience ?? "user",
    organizationId: row.organization_id ?? null,
    projectId: row.project_id ?? null,
    actorId: row.actor_id ?? null,
    actor: asObject(row.actor),
    actions: asArray(row.actions),
    groupKey: row.group_key ?? null,
    dedupeKey: row.dedupe_key ?? null,
    expiresAt: row.expires_at ?? null,
    data: asObject(row.metadata),
    createdAt: row.created_at ?? null,
    notifiedAt: row.notified_at ?? row.created_at ?? null,
    seenAt: row.seen_at ?? null,
    readAt: row.read_at ?? null,
    archivedAt: row.archived_at ?? null,
    isRead: Boolean(row.read_at),
    isSeen: Boolean(row.seen_at),
    isArchived: Boolean(row.archived_at),
  };
}

export function normalizePreference(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id ?? null,
    app: row.app ?? "*",
    category: row.category ?? "*",
    type: row.type ?? "*",
    muted: row.muted !== false,
    mutedUntil: row.muted_until ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

// `to` accepts a user id, an array of ids, or { user, users, organization, roles, exclude }.
export function normalizeAudience(to) {
  if (!to) return {};
  if (typeof to === "string") return { user: to };
  if (Array.isArray(to)) return { users: to.filter(Boolean) };
  const out = {};
  if (to.user) out.user = to.user;
  if (Array.isArray(to.users) && to.users.length) out.users = to.users.filter(Boolean);
  const organization = to.organization ?? to.organizationId ?? to.org;
  if (organization) out.organization = organization;
  if (Array.isArray(to.roles) && to.roles.length) out.roles = to.roles;
  if (Array.isArray(to.exclude) && to.exclude.length) out.exclude = to.exclude.filter(Boolean);
  return out;
}

const SEND_FIELDS = {
  app: "app",
  category: "category",
  type: "type",
  title: "title",
  body: "body",
  url: "url",
  icon: "icon",
  imageUrl: "image_url",
  tone: "tone",
  priority: "priority",
  organizationId: "organization_id",
  projectId: "project_id",
  actorId: "actor_id",
  actor: "actor",
  actions: "actions",
  groupKey: "group_key",
  dedupeKey: "dedupe_key",
  onConflict: "on_conflict",
  resurface: "resurface",
  includeActor: "include_actor",
  expiresAt: "expires_at",
};

// camelCase send input → the jsonb payload notify.send() expects; only present keys are emitted.
export function toSendPayload(input = {}) {
  const payload = {};
  for (const [key, column] of Object.entries(SEND_FIELDS)) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== "") payload[column] = input[key];
  }
  const data = input.data ?? input.metadata;
  if (data && typeof data === "object") payload.metadata = data;
  if (Array.isArray(payload.actions)) {
    payload.actions = payload.actions
      .filter((action) => action && action.label)
      .map(({ label, url, variant, id, markRead }) => ({ label, url, variant, id, markRead }));
  }
  payload.to = normalizeAudience(input.to);
  return payload;
}
