# @geiger/notify

Cross-app notifications for the Geiger suite. Any app can **send** a notification to a
user, a list of users, or a whole organization (optionally narrowed by member role), and
any app can **receive** them, live, on the browser's existing Supabase session. All suite
apps share one origin (`geiger.studio`) and one Supabase project, so a notification sent
from Events shows up in the bell in Dash, Notes, Forms and everywhere else.

Source-shipped and GitHub-installed like `@geiger/ui`: plain JS/JSX with no build step.

```
@geiger/notify          core (browser + server): createNotifier, type registry, helpers
@geiger/notify/react    NotificationsProvider, hooks, NotificationBell, NotificationPreferences
@geiger/notify/server   createServerNotifier (service role: cron, webhooks, server actions)
```

---

## 1. Database

The `notify` schema is owned by **geiger-dash**
(`supabase/migrations/20261010114631_notify_notifications.sql`, applied with `npm run db:push`
there). Product apps never migrate it.

| Object | Purpose |
|---|---|
| `notify.notifications` | one row per message: `app`, `category`, `type`, `title`, `body`, `url`, `icon`, `image_url`, `tone`, `priority`, `audience`, `organization_id`, `project_id`, `actor_id`, `actor`, `actions`, `group_key`, `dedupe_key`, `expires_at`, `metadata` |
| `notify.deliveries` | one row per recipient: `user_id`, `notified_at`, `seen_at`, `read_at`, `archived_at`, `deleted_at` (in the `supabase_realtime` publication) |
| `notify.preferences` | per-user mute rules `(app, category, type)` with `*` wildcards, `muted`, `muted_until` |
| `notify.inbox` | security-invoker view: the caller's live deliveries joined with their notification |
| `notify.send(p jsonb)` | resolves the audience, applies mutes, fans out deliveries atomically |
| `notify.mark_all_read(app, category, organization_id)` | bulk read |
| `notify.unread_counts(organization_id)` | `{ total, unseen, apps, categories }` |
| `notify.retract(id, app, dedupe_key)` | withdraws a notification for everyone |

**One-time setup:** `notify` must be in Supabase **Settings → API → Exposed schemas**.

### Security model

- Clients can't insert notifications directly. Every send goes through `notify.send()`.
- A signed-in sender may notify **themselves**, **users who share an organization** with them,
  or **an organization they belong to**. Anything else is rejected.
- For session senders the actor is always the caller, so it can't be spoofed. The actor's display
  name and avatar are snapshotted from `auth.users`.
- Recipients can read only their own deliveries. They can update only `seen_at`, `read_at`,
  `archived_at` and `deleted_at`, because column-level grants enforce it.
- The **service role** is trusted. It may target anyone and set `actorId` / `actor`.
- Links are rendered only if they are `http(s)` or root-relative, so a `javascript:` URL is never followed.

---

## 2. Install & wire up

```bash
npm i github:<owner>/geiger-notify#<tag-or-sha>
```

```js
// next.config.mjs
transpilePackages: ["@geiger/ui", "@geiger/notify"],
```

```css
/* app/globals.css: let Tailwind see the package's classes */
@source "../node_modules/@geiger/notify/src";
```

Peers (already in every suite app): `react`, `@geiger/ui`, `lucide-react`,
`@supabase/supabase-js`. The React layer imports `@geiger/ui` subpaths only, so it's safe
next to Server Components.

---

## 3. Receiving: the bell

Pass the app's **own** browser session client. The package never builds one, so cookie
options such as `NEXT_PUBLIC_COOKIE_DOMAIN` stay exactly as the app configured them.

```jsx
"use client";
import { useState } from "react";
import { toast } from "sonner";
import { NotificationBell } from "@geiger/notify/react";
import { createClient } from "@/lib/supabase/client";

export function TopbarNotifications() {
  const [supabase] = useState(createClient);
  return (
    <NotificationBell
      supabase={supabase}
      app="events"
      onReceive={(n) => toast(n.title, { description: n.body })}
    />
  );
}
```

Drop it into `@geiger/ui`'s `<Topbar notifications={<TopbarNotifications />} />` slot, or
anywhere else. The bell includes:

- All / Unread / Archived tabs
- per-app filter chips
- Today / Yesterday / This week / Earlier sections
- read, archive and dismiss actions on each row
- action buttons, "Mark all as read" and paging
- realtime updates
- a settings panel with mute switches

### Bell props

| Prop | Default | |
|---|---|---|
| `supabase` | — | app session client (not needed inside a provider) |
| `notifier` | — | a ready `createNotifier()` instance to use instead of building one from `supabase` |
| `app` | `null` | the current app id |
| `scope` | all apps | `{ apps, categories, organizationId }`: what this bell shows |
| `onReceive(n)` | — | fires once per new unread arrival (toast, title badge…) |
| `sound` | `true` | plays the suite chime for new arrivals (see [Sound](#sound)) |
| `onError(error, scope)` | — | failed mutations (`scope`: `markRead`, `archive`…, `realtime`) |
| `onNavigate(url, n)` | same tab for root-relative URLs, new tab for other origins | override navigation, e.g. `router.push` for this app's own links |
| `onAction(n, action)` | — | return `true` to take over an action button; otherwise it marks read and follows `action.url` |
| `renderers` | — | custom row components (see below) |
| `trigger` | bell button | your own trigger element |
| `title`, `align`, `sideOffset`, `className`, `contentClassName` | | presentation |
| `showAppFilter`, `showSettings` | `true` | toggle chrome |
| `preferenceApps`, `preferenceCategories` | suite defaults | rows listed in settings |
| `pageSize`, `realtime` | `20`, `true` | feed tuning |

### Sound

New unread arrivals play **Counter**, the suite chime: two soft ticks, then a tone. It's synthesized
with Web Audio, so there's no file to host. The rules:

- **Which arrivals:** every priority except `low`. A notification that resurfaces with
  `onConflict: "replace"` chimes again.
- **Once per arrival:** with Dash, Notes and Events open in three tabs, only one tab plays it. Tabs
  coordinate through `localStorage` and the Web Locks API on the shared origin, and a visible tab
  gets the first chance.
- **At most once every 3 seconds** (`CHIME_GAP_MS`) across all tabs, so a burst chimes once.
- **Only after a gesture:** browsers block sound until the user has clicked or typed on the page.
  The provider unlocks audio on the first pointer or key press.

Users turn it off with **Play a sound** in the bell's settings. The choice is saved per browser in
`localStorage` and shared by every suite app. Pass `sound={false}` to the bell or provider to
silence an app and hide that switch. To play the chime yourself, import `chime()` from
`@geiger/notify`.

### Custom renderers

Renderers are looked up in this order: `"<app>:<type>"`, then `"<app>:*"`, then `"<type>"`, then `"category:<category>"`.

```jsx
<NotificationBell
  supabase={supabase}
  renderers={{
    "events:ticket.sold": ({ notification, helpers }) => (
      <TicketSoldRow ticket={notification.data} onClick={() => helpers.open(notification)} />
    ),
  }}
/>
```

`helpers` provides `open`, `runAction`, `toggleRead`, `archive`, `dismiss` and `close`. The built-in row is
exported as `NotificationItem` for reuse.

### Your own UI

```jsx
<NotificationsProvider supabase={supabase} app="notes" scope={{ apps: ["notes"] }}>
  <MyInbox />          {/* useNotifications() */}
  <NotificationBell /> {/* reuses the provider's feed */}
</NotificationsProvider>
```

`useNotifications()` returns:

- feed state: `items`, `loading`, `hasMore`, `loadMore`, `refresh`
- filters: `view`/`setView`, `appFilter`/`setAppFilter`
- counts: `counts`, `unreadCount`
- actions: `markRead`, `markUnread`, `toggleRead`, `archive`, `unarchive`, `dismiss`, `markAllRead`, `markAllSeen`
- preferences: `preferences`, `loadPreferences`, `setMuted`, `isMuted`, `isRuleMuted`
- sound: `sound` (the prop), `soundEnabled`, `setSoundEnabled`
- the session: `notifier`, `userId`, `signedIn`

Every mutation is optimistic. On failure the provider reloads from the server and calls `onError`.

Two smaller hooks are also exported: `useUnreadCount()` for a badge anywhere, and `useNotifier()`
to send from client components.

---

## 4. Sending

### Declare your types once

```js
// lib/notifications/types.js
import { defineNotificationTypes } from "@geiger/notify";

export const EVENTS_NOTIFICATION_TYPES = defineNotificationTypes({
  "ticket.sold": {
    category: "update",
    icon: "Ticket",
    tone: "success",
    title: (d) => `${d.buyer} bought ${d.qty} ticket${d.qty > 1 ? "s" : ""}`,
    body: (d) => d.eventName,
    url: (d) => `/events/${d.eventId}`,
    groupKey: (d) => `event:${d.eventId}:sales`,
  },
  "event.reminder": {
    category: "reminder",
    icon: "AlarmClock",
    priority: "high",
    title: (d) => `${d.eventName} starts in 1 hour`,
    expiresIn: "2h",
    dedupeKey: (d) => `reminder:${d.eventId}`,
    actions: (d) => [{ label: "Open event", url: `/events/${d.eventId}`, variant: "primary" }],
  },
});
```

Any preset field can be a value or a function `(data, input) => value`. Fields given explicitly at send
time always win, and app-wide `defaults` sit underneath both.

### Send as the signed-in user

```js
import { createNotifier } from "@geiger/notify";

const notify = createNotifier(supabase, { app: "events", types: EVENTS_NOTIFICATION_TYPES });

await notify.notifyOrganization(orgId, "ticket.sold", {
  roles: ["Owner", "Manager"],  // optional role filter, case-insensitive
  exclude: [someUserId],        // optional
  organizationId: orgId,
  projectId,
  data: { buyer: "Ann", qty: 2, eventId, eventName },
});

await notify.notifyUser(userId, { title: "Your export is ready", url: "/events/exports/42", tone: "success" });
await notify.notifyUsers([a, b], "event.reminder", { data: { eventId, eventName } });
await notify.send({ type: "ticket.sold", to: { organization: orgId }, data: { … } });
```

Each call returns `{ id, delivered, recipients, deduped, replaced }`, or `null` on failure. Failures
are logged with `console.error("[notify.send]", …)`. You can also pass `onError`, or set `throwOnError: true`.

### Send from trusted server code

```js
import { createServerNotifier } from "@geiger/notify/server";

// Uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or pass { supabase: adminClient }.
const notify = createServerNotifier({ app: "pods", types: PODS_NOTIFICATION_TYPES });
await notify.notifyOrganization(orgId, "alarm.fired", { priority: "urgent", actorId: null, actor: { name: "Pods monitor" } });
```

In Next.js, wrap sends in `after()` so they never delay or fail the mutation (see dash's
`lib/notifications/send.js`).

### All send fields

| Field | Notes |
|---|---|
| `to` | `"uuid"`, `["uuid", …]`, or `{ user, users, organization, roles, exclude }` |
| `app` | defaults to the notifier's `app` |
| `type` | preset key / app-specific type; defaults to `category` |
| `category` | `general` `mention` `comment` `assignment` `invite` `reminder` `update` `alert` `billing` `security` `system`, or your own |
| `title` *(required)*, `body` | plain text |
| `url` | root-relative (`/notes/abc`) or absolute |
| `icon` | lucide name (`"Ticket"`); defaults to the category's icon |
| `imageUrl` | thumbnail; otherwise the actor's avatar is shown |
| `tone` | `neutral` `info` `success` `warning` `danger` |
| `priority` | `low` `normal` `high` `urgent`; **urgent bypasses mute rules** |
| `actions` | `[{ label, url?, variant: "primary" \| "secondary", id?, markRead? }]` |
| `organizationId`, `projectId` | context (FKs to `public.organizations` / `public.projects`) |
| `data` | free-form payload handed to custom renderers as `notification.data` |
| `groupKey` | thread related notifications |
| `dedupeKey` + `onConflict` | idempotency per app. `"skip"` (default) returns the live one; `"replace"` rewrites it |
| `resurface` | with `replace`: `true` (default) marks it unread again and moves it to the top |
| `expiresAt` / `expiresIn` | hide after a time (`"45s"`, `"30m"`, `"12h"`, `"7d"`, `"2w"`, ms) |
| `includeActor` | also deliver to the sender in an org fan-out (default `false`) |
| `actorId`, `actor` | service role only: who did it, plus a `{ name, avatarUrl }` override |

`notify.retract(id)` or `notify.retract({ app, dedupeKey })` withdraws a notification. Only the sender
or the service role can do this.

### Reading and state from code

`list({ view, app, apps, category, categories, type, organizationId, projectId, groupKey, userId, before, limit })`,
`get(id)`, `unreadCounts({ organizationId })`, `markRead(ids)`, `markUnread`, `markSeen`, `markAllSeen()`,
`markAllRead({ app, category, organizationId })`, `archive`, `unarchive`, `dismiss`, and
`subscribe(userId, { onChange, onStatus })`.

`subscribe` returns an unsubscribe function. `onChange` receives `{ event, id, delivery, load }`.

---

## 5. Preferences (mute rules)

Rules are `(app, category, type)` triples, where `*` matches anything. The **most specific live rule
wins**, and a rule with `muted: false` is an explicit override. Snoozes use `mutedUntil`.

```js
await notify.mute({ app: "events" });                                    // mute Events
await notify.setPreference({ app: "events", category: "mention", muted: false }); // …but keep mentions
await notify.mute({}, { until: new Date(Date.now() + 8 * 3600e3).toISOString() }); // pause all for 8h
await notify.unmute({ app: "events" });                                  // remove the rule
```

`listPreferences()` returns the signed-in user's rules, and `clearPreference(scope)` deletes one
(it's what `unmute` calls) so broader rules apply again.

The bell's settings panel writes app-level and category-level rules, plus a master switch. Mutes are
applied when a notification is sent, so a muted notification is never delivered. Urgent ones always get through.

---

## 6. Notes

- **Local dev:** each app runs on its own `localhost` port with its own cookies, so cross-app
  delivery works in production on `geiger.studio`, while locally each app sees the same data only
  when signed in to the same account.
- **Conventions:** follows the suite data-layer contract: tri-state `null` / `false` / `[]`
  returns, `console.error` on failure, never toasts.
- **Tests:** `npm test` runs node's built-in test runner over the core.
