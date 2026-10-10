import { ANY, NOTIFY_SCHEMA } from "./constants.js";
import { normalizeNotification, normalizePreference, toSendPayload } from "./normalize.js";
import { applyPreset } from "./registry.js";
import { resolveExpiresAt } from "./time.js";

const PREFERENCE_CONFLICT = "user_id,app,category,type";

function toIds(ids) {
  return (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
}

// Notifier bound to the app's own supabase-js client, so every call runs on that
// client's session (the browser's signed-in user, or the service role on a server).
// Follows the suite data-layer contract: never throws (unless throwOnError), logs
// failures and returns null / false / [] so the caller owns the UX.
export function createNotifier(supabase, options = {}) {
  if (!supabase || typeof supabase.schema !== "function") {
    throw new TypeError("createNotifier: pass a supabase-js v2 client (the app's own session client)");
  }
  const { app = null, types = {}, defaults = {}, pageSize = 20, onError = null, throwOnError = false } = options;
  const db = () => supabase.schema(NOTIFY_SCHEMA);

  function fail(scope, error) {
    console.error(`[notify.${scope}]`, error?.message ?? error);
    onError?.(error, scope);
    if (throwOnError) throw error instanceof Error ? error : new Error(error?.message ?? String(error));
  }

  async function run(scope, fallback, task) {
    try {
      const { data, error } = await task();
      if (error) {
        fail(scope, error);
        return fallback;
      }
      return data;
    } catch (error) {
      if (throwOnError) throw error;
      fail(scope, error);
      return fallback;
    }
  }

  async function getUserId() {
    try {
      const { data } = await supabase.auth.getSession();
      return data?.session?.user?.id ?? null;
    } catch {
      return null;
    }
  }

  // --- Sending ----------------------------------------------------------------

  // send(input) or send(type, input). Merge order: defaults < type preset < input.
  async function send(typeOrInput, maybeInput) {
    const input = typeof typeOrInput === "string" ? { ...maybeInput, type: typeOrInput } : { ...typeOrInput };
    const merged = { ...defaults, ...applyPreset(input.type ? types[input.type] : null, input) };
    merged.app = merged.app || app;
    if (!merged.app) {
      fail("send", new Error("app is required: pass it to createNotifier({ app }) or send({ app })"));
      return null;
    }
    if (!merged.title) {
      fail("send", new Error(`title is required${merged.type ? ` for type "${merged.type}"` : ""}`));
      return null;
    }
    merged.expiresAt = resolveExpiresAt(merged);
    const result = await run("send", null, () => db().rpc("send", { p: toSendPayload(merged) }));
    if (!result) return null;
    return {
      id: result.id,
      delivered: result.delivered ?? 0,
      recipients: result.recipients ?? 0,
      deduped: Boolean(result.deduped),
      replaced: Boolean(result.replaced),
    };
  }

  function withAudience(to, typeOrInput, maybeInput) {
    if (typeof typeOrInput === "string") return send(typeOrInput, { ...maybeInput, to });
    return send({ ...typeOrInput, to });
  }

  const notifyUser = (userId, typeOrInput, input) => withAudience({ user: userId }, typeOrInput, input);
  const notifyUsers = (userIds, typeOrInput, input) => withAudience({ users: userIds }, typeOrInput, input);

  // `input.roles` narrows to member roles; `input.exclude` drops specific users.
  function notifyOrganization(organizationId, typeOrInput, input) {
    const source = typeof typeOrInput === "string" ? input || {} : typeOrInput || {};
    const to = { organization: organizationId, roles: source.roles, exclude: source.exclude };
    return withAudience(to, typeOrInput, input);
  }

  async function retract(target) {
    const args = typeof target === "string"
      ? { p_id: target }
      : { p_id: target?.id ?? null, p_app: target?.app ?? app, p_dedupe_key: target?.dedupeKey ?? null };
    return Boolean(await run("retract", false, () => db().rpc("retract", args)));
  }

  // --- Receiving --------------------------------------------------------------

  // view: "all" (inbox, not archived) | "unread" | "archived". `before` pages by notifiedAt.
  async function list(filters = {}) {
    const {
      view = "all",
      app: onlyApp,
      apps,
      category,
      categories,
      type,
      organizationId,
      projectId,
      groupKey,
      userId,
      before,
      limit = pageSize,
    } = filters;
    const rows = await run("list", null, () => {
      let query = db().from("inbox").select("*").order("notified_at", { ascending: false }).limit(limit);
      if (view === "unread") query = query.is("read_at", null).is("archived_at", null);
      else if (view === "archived") query = query.not("archived_at", "is", null);
      else query = query.is("archived_at", null);
      if (userId) query = query.eq("user_id", userId);
      if (onlyApp) query = query.eq("app", onlyApp);
      if (apps?.length) query = query.in("app", apps);
      if (category) query = query.eq("category", category);
      if (categories?.length) query = query.in("category", categories);
      if (type) query = query.eq("type", type);
      if (organizationId) query = query.eq("organization_id", organizationId);
      if (projectId) query = query.eq("project_id", projectId);
      if (groupKey) query = query.eq("group_key", groupKey);
      if (before) query = query.lt("notified_at", before);
      return query;
    });
    return rows ? rows.map(normalizeNotification) : null;
  }

  async function get(id) {
    if (!id) return null;
    const row = await run("get", null, () => db().from("inbox").select("*").eq("id", id).maybeSingle());
    return normalizeNotification(row);
  }

  async function unreadCounts({ organizationId = null } = {}) {
    const counts = await run("counts", null, () =>
      db().rpc("unread_counts", organizationId ? { p_organization_id: organizationId } : {}),
    );
    if (!counts) return null;
    return {
      total: counts.total ?? 0,
      unseen: counts.unseen ?? 0,
      apps: counts.apps ?? {},
      categories: counts.categories ?? {},
    };
  }

  async function updateDeliveries(scope, ids, patch) {
    const list = toIds(ids);
    if (!list.length) return true;
    const data = await run(scope, null, () => db().from("deliveries").update(patch).in("id", list).select("id"));
    return Array.isArray(data);
  }

  const now = () => new Date().toISOString();
  const markRead = (ids) => updateDeliveries("markRead", ids, { read_at: now() });
  const markUnread = (ids) => updateDeliveries("markUnread", ids, { read_at: null });
  const markSeen = (ids) => updateDeliveries("markSeen", ids, { seen_at: now() });
  const archive = (ids) => updateDeliveries("archive", ids, { archived_at: now() });
  const unarchive = (ids) => updateDeliveries("unarchive", ids, { archived_at: null });
  const dismiss = (ids) => updateDeliveries("dismiss", ids, { deleted_at: now() });

  async function markAllSeen() {
    const userId = await getUserId();
    if (!userId) return false;
    const data = await run("markAllSeen", null, () =>
      db().from("deliveries").update({ seen_at: now() }).eq("user_id", userId).is("seen_at", null).select("id"),
    );
    return Array.isArray(data);
  }

  // Returns how many deliveries changed, or null on failure.
  async function markAllRead({ app: onlyApp = null, category = null, organizationId = null } = {}) {
    return run("markAllRead", null, () =>
      db().rpc("mark_all_read", { p_app: onlyApp, p_category: category, p_organization_id: organizationId }),
    );
  }

  // Live changes to the user's deliveries. `delivery` is the raw row; `load()` re-reads it
  // through the inbox view (null once retracted, dismissed or expired). Returns an unsubscribe.
  function subscribe(userId, { onChange, onStatus } = {}) {
    if (!userId || typeof supabase.channel !== "function") return () => {};
    const channel = supabase
      .channel(`notify:${userId}:${Math.random().toString(36).slice(2, 10)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: NOTIFY_SCHEMA, table: "deliveries", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
          if (!row?.id) return;
          const event = payload.eventType === "INSERT" ? "insert" : payload.eventType === "DELETE" ? "delete" : "update";
          onChange?.({ event, id: row.id, delivery: row, load: () => get(row.id) });
        },
      )
      .subscribe((status, error) => onStatus?.(status, error));
    return () => {
      supabase.removeChannel(channel);
    };
  }

  // --- Preferences ------------------------------------------------------------

  async function listPreferences() {
    const rows = await run("preferences", null, () =>
      db().from("preferences").select("*").is("deleted_at", null).order("updated_at", { ascending: false }),
    );
    return rows ? rows.map(normalizePreference) : null;
  }

  // Upserts a rule; muted:false is an explicit override that beats broader mutes.
  async function setPreference({ app: ruleApp = ANY, category = ANY, type = ANY, muted = true, mutedUntil = null } = {}) {
    const userId = await getUserId();
    if (!userId) {
      fail("setPreference", new Error("no signed-in user"));
      return null;
    }
    const row = await run("setPreference", null, () =>
      db()
        .from("preferences")
        .upsert(
          { user_id: userId, app: ruleApp, category, type, muted, muted_until: mutedUntil, deleted_at: null },
          { onConflict: PREFERENCE_CONFLICT },
        )
        .select("*")
        .single(),
    );
    return normalizePreference(row);
  }

  // Removes a rule so broader rules apply again.
  async function clearPreference({ app: ruleApp = ANY, category = ANY, type = ANY } = {}) {
    const data = await run("clearPreference", null, () =>
      db().from("preferences").delete().eq("app", ruleApp).eq("category", category).eq("type", type).select("id"),
    );
    return Array.isArray(data);
  }

  const mute = (scope = {}, { until = null } = {}) => setPreference({ ...scope, muted: true, mutedUntil: until });
  const unmute = (scope = {}) => clearPreference(scope);

  return {
    app,
    supabase,
    getUserId,
    send,
    notifyUser,
    notifyUsers,
    notifyOrganization,
    retract,
    list,
    get,
    unreadCounts,
    markRead,
    markUnread,
    markSeen,
    markAllSeen,
    markAllRead,
    archive,
    unarchive,
    dismiss,
    subscribe,
    listPreferences,
    setPreference,
    clearPreference,
    mute,
    unmute,
  };
}
