import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyPreset,
  createNotifier,
  dayBucket,
  defineNotificationTypes,
  formatRelativeTime,
  normalizeNotification,
  parseDuration,
  resolveExpiresAt,
  resolveMuted,
  toSendPayload,
} from "../src/index.js";

// Minimal supabase-js stand-in: records every builder call, resolves to `result`.
function fakeSupabase(result = { data: null, error: null }) {
  const calls = [];
  const builder = (path) =>
    new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then") return (resolve) => resolve(typeof result === "function" ? result(path) : result);
          return (...args) => {
            calls.push([...path, prop, args]);
            return builder([...path, prop]);
          };
        },
      },
    );
  const client = {
    calls,
    schema: (name) => {
      calls.push(["schema", name]);
      return builder([]);
    },
    auth: { getSession: async () => ({ data: { session: { user: { id: "u-1" } } } }) },
  };
  return client;
}

test("parseDuration and resolveExpiresAt", () => {
  assert.equal(parseDuration("2h"), 7_200_000);
  assert.equal(parseDuration("7d"), 604_800_000);
  assert.equal(parseDuration(500), 500);
  assert.equal(parseDuration("soon"), null);
  assert.equal(resolveExpiresAt({ expiresIn: "1h" }, 0), new Date(3_600_000).toISOString());
  assert.equal(resolveExpiresAt({ expiresAt: "2030-01-01T00:00:00Z", expiresIn: "1h" }), "2030-01-01T00:00:00.000Z");
  assert.equal(resolveExpiresAt({}), null);
});

test("formatRelativeTime and dayBucket", () => {
  const now = new Date("2026-10-10T12:00:00").getTime();
  assert.equal(formatRelativeTime(new Date(now - 10_000), now), "now");
  assert.equal(formatRelativeTime(new Date(now - 5 * 60_000), now), "5m");
  assert.equal(formatRelativeTime(new Date(now - 3 * 3_600_000), now), "3h");
  assert.equal(formatRelativeTime(new Date(now - 2 * 86_400_000), now), "2d");
  assert.equal(dayBucket(new Date(now - 60_000), now), "Today");
  assert.equal(dayBucket(new Date("2026-10-09T08:00:00"), now), "Yesterday");
  assert.equal(dayBucket(new Date("2026-09-01T08:00:00"), now), "Earlier");
});

test("toSendPayload maps camelCase, audience forms and drops empties", () => {
  const payload = toSendPayload({
    app: "events",
    title: "Hi",
    body: "",
    imageUrl: "https://x/y.png",
    organizationId: "org-1",
    data: { ticket: 7 },
    actions: [{ label: "Open", url: "/events/1", variant: "primary", junk: true }, { url: "/no-label" }],
    to: { org: "org-1", roles: ["Owner"], exclude: ["u-2"] },
  });
  assert.deepEqual(payload, {
    app: "events",
    title: "Hi",
    image_url: "https://x/y.png",
    organization_id: "org-1",
    metadata: { ticket: 7 },
    actions: [{ label: "Open", url: "/events/1", variant: "primary", id: undefined, markRead: undefined }],
    to: { organization: "org-1", roles: ["Owner"], exclude: ["u-2"] },
  });
  assert.deepEqual(toSendPayload({ to: "u-1" }).to, { user: "u-1" });
  assert.deepEqual(toSendPayload({ to: ["u-1", "", "u-2"] }).to, { users: ["u-1", "u-2"] });
});

test("normalizeNotification produces the camelCase view model", () => {
  const n = normalizeNotification({
    id: "d-1",
    notification_id: "n-1",
    app: "dash",
    title: "T",
    read_at: "2026-10-10T00:00:00Z",
    metadata: { a: 1 },
    actions: null,
    actor: { name: "Ann" },
    notified_at: "2026-10-10T00:00:00Z",
  });
  assert.equal(n.id, "d-1");
  assert.equal(n.isRead, true);
  assert.equal(n.isArchived, false);
  assert.deepEqual(n.data, { a: 1 });
  assert.deepEqual(n.actions, []);
  assert.equal(n.actor.name, "Ann");
});

test("defineNotificationTypes validates and applyPreset lets input win", () => {
  assert.throws(() => defineNotificationTypes({ x: { nope: 1 } }), /unknown field/);
  const types = defineNotificationTypes({
    "ticket.sold": {
      category: "update",
      tone: "success",
      title: (data) => `${data.buyer} bought a ticket`,
      dedupeKey: (data) => `ticket:${data.id}`,
    },
  });
  const merged = applyPreset(types["ticket.sold"], { data: { buyer: "Ann", id: 9 }, tone: "info" });
  assert.equal(merged.title, "Ann bought a ticket");
  assert.equal(merged.dedupeKey, "ticket:9");
  assert.equal(merged.tone, "info");
  assert.equal(merged.category, "update");
});

test("resolveMuted: most specific live rule wins", () => {
  const prefs = [
    { app: "*", category: "*", type: "*", muted: true },
    { app: "events", category: "*", type: "*", muted: false },
    { app: "events", category: "mention", type: "*", muted: true, mutedUntil: "2000-01-01T00:00:00Z" },
  ];
  assert.equal(resolveMuted(prefs, { app: "notes", category: "general", type: "x" }), true);
  assert.equal(resolveMuted(prefs, { app: "events", category: "mention", type: "x" }), false);
  assert.equal(resolveMuted([], { app: "dash" }), false);
});

test("send resolves type presets and calls notify.send with the payload", async () => {
  const supabase = fakeSupabase({ data: { id: "n-1", delivered: 3, recipients: 3, deduped: false, replaced: false }, error: null });
  const notifier = createNotifier(supabase, {
    app: "events",
    types: defineNotificationTypes({ welcome: { title: (d) => `Hi ${d.name}`, icon: "Hand", expiresIn: "1d" } }),
  });
  const result = await notifier.notifyOrganization("org-1", "welcome", { data: { name: "Ann" }, roles: ["Owner"] });
  assert.deepEqual(result, { id: "n-1", delivered: 3, recipients: 3, deduped: false, replaced: false });
  const rpc = supabase.calls.find((call) => call[0] === "rpc");
  assert.equal(rpc[1][0], "send");
  const p = rpc[1][1].p;
  assert.equal(p.app, "events");
  assert.equal(p.type, "welcome");
  assert.equal(p.title, "Hi Ann");
  assert.equal(p.icon, "Hand");
  assert.ok(p.expires_at);
  assert.deepEqual(p.to, { organization: "org-1", roles: ["Owner"] });
});

test("send fails soft without app/title and on RPC error", async () => {
  const errors = [];
  const original = console.error;
  console.error = () => {};
  try {
    const ok = createNotifier(fakeSupabase(), { onError: (e) => errors.push(e.message) });
    assert.equal(await ok.send({ title: "x", to: "u" }), null);
    const noTitle = createNotifier(fakeSupabase(), { app: "dash", onError: (e) => errors.push(e.message) });
    assert.equal(await noTitle.send({ to: "u" }), null);
    const failing = createNotifier(fakeSupabase({ data: null, error: { message: "denied" } }), {
      app: "dash",
      onError: (e) => errors.push(e.message),
    });
    assert.equal(await failing.send({ title: "x", to: "u" }), null);
    const throwing = createNotifier(fakeSupabase({ data: null, error: { message: "boom" } }), { app: "dash", throwOnError: true });
    await assert.rejects(() => throwing.send({ title: "x", to: "u" }), /boom/);
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 3);
  assert.match(errors[0], /app is required/);
  assert.match(errors[1], /title is required/);
  assert.equal(errors[2], "denied");
});

test("list builds the inbox query for the unread view", async () => {
  const supabase = fakeSupabase({ data: [{ id: "d-1", app: "dash", title: "x" }], error: null });
  const notifier = createNotifier(supabase);
  const rows = await notifier.list({ view: "unread", apps: ["dash"], before: "2026-01-01" });
  assert.equal(rows[0].id, "d-1");
  const names = supabase.calls.map((call) => call[call.length - 2]);
  assert.deepEqual(supabase.calls[0], ["schema", "notify"]);
  for (const name of ["from", "select", "order", "limit", "is", "in", "lt"]) assert.ok(names.includes(name), name);
});
