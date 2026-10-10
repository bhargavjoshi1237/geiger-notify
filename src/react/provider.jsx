"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createNotifier } from "../core/client.js";
import { findRule, isRuleMuted, resolveMuted } from "../core/preferences.js";
import { ANY } from "../core/constants.js";

const NotificationsContext = createContext(null);
const EMPTY_COUNTS = { total: 0, unseen: 0, apps: {}, categories: {} };
// Window in which an off-page realtime update counts as a (re)surfaced arrival; allows for clock skew.
const FRESH_MS = 5 * 60_000;

function time(value) {
  return value ? new Date(value).getTime() : 0;
}

function sortFeed(items) {
  return [...items].sort((a, b) => time(b.notifiedAt) - time(a.notifiedAt));
}

function inScope(item, scope) {
  if (scope.apps?.length && !scope.apps.includes(item.app)) return false;
  if (scope.categories?.length && !scope.categories.includes(item.category)) return false;
  if (scope.organizationId && item.organizationId !== scope.organizationId) return false;
  return true;
}

function inView(item, view, appFilter) {
  if (appFilter && item.app !== appFilter) return false;
  if (view === "archived") return item.isArchived;
  if (view === "unread") return !item.isRead && !item.isArchived;
  return !item.isArchived;
}

// Delivery-state columns from a realtime row, as view-model fields.
function deliveryPatch(row) {
  return {
    readAt: row.read_at ?? null,
    seenAt: row.seen_at ?? null,
    archivedAt: row.archived_at ?? null,
    isRead: Boolean(row.read_at),
    isSeen: Boolean(row.seen_at),
    isArchived: Boolean(row.archived_at),
  };
}

// Feeds the bell (or any custom inbox UI) from the user's own session: paged inbox,
// unread counts, live updates, optimistic read/archive state and mute preferences.
// `supabase` must be the app's stable session client; `scope` narrows what is shown
// ({ apps, categories, organizationId }); `onReceive` fires for each new arrival.
export function NotificationsProvider({
  supabase,
  app = null,
  notifier: notifierProp = null,
  scope: scopeProp,
  pageSize = 20,
  realtime = true,
  onReceive,
  onError,
  children,
}) {
  const notifier = useMemo(
    () => notifierProp ?? (supabase ? createNotifier(supabase, { app, pageSize }) : null),
    [notifierProp, supabase, app, pageSize],
  );
  const scopeKey = JSON.stringify(scopeProp || {});
  const scope = useMemo(() => JSON.parse(scopeKey), [scopeKey]);

  const [userId, setUserId] = useState(undefined);
  const [view, setView] = useState("all");
  const [appFilter, setAppFilter] = useState(null);
  const [feed, setFeed] = useState({ key: null, items: [], hasMore: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [preferences, setPreferences] = useState(null);

  const callbacks = useRef({ onReceive, onError });
  const live = useRef({ view, appFilter, scope, items: feed.items });
  useEffect(() => {
    callbacks.current = { onReceive, onError };
    live.current = { view, appFilter, scope, items: feed.items };
  });

  // The signed-in user comes from the app's session; INITIAL_SESSION fires immediately.
  useEffect(() => {
    if (!notifier) return undefined;
    const {
      data: { subscription },
    } = notifier.supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, [notifier]);

  const filters = useMemo(
    () => ({
      view,
      app: appFilter || undefined,
      apps: scope.apps,
      categories: scope.categories,
      organizationId: scope.organizationId,
    }),
    [view, appFilter, scope],
  );
  const feedKey = userId ? JSON.stringify([userId, filters]) : null;

  useEffect(() => {
    if (!notifier || !feedKey) return undefined;
    let alive = true;
    notifier.list({ ...filters, limit: pageSize }).then((rows) => {
      if (!alive) return;
      setFeed({ key: feedKey, items: rows ?? [], hasMore: (rows?.length ?? 0) >= pageSize });
    });
    return () => {
      alive = false;
    };
  }, [notifier, feedKey, filters, pageSize]);

  const refreshCounts = useCallback(async () => {
    if (!notifier || !userId) return;
    const next = await notifier.unreadCounts({ organizationId: scope.organizationId });
    if (next) setCounts(next);
  }, [notifier, userId, scope.organizationId]);

  useEffect(() => {
    if (!notifier || !userId) return undefined;
    let alive = true;
    notifier.unreadCounts({ organizationId: scope.organizationId }).then((next) => {
      if (alive && next) setCounts(next);
    });
    return () => {
      alive = false;
    };
  }, [notifier, userId, scope.organizationId]);

  const refresh = useCallback(async () => {
    if (!notifier || !feedKey) return;
    const rows = await notifier.list({ ...filters, limit: pageSize });
    setFeed({ key: feedKey, items: rows ?? [], hasMore: (rows?.length ?? 0) >= pageSize });
    refreshCounts();
  }, [notifier, feedKey, filters, pageSize, refreshCounts]);

  // Live updates: patch known rows in place, load unknown or resurfaced ones.
  useEffect(() => {
    if (!realtime || !notifier || !userId) return undefined;
    let timer = null;
    const bumpCounts = () => {
      clearTimeout(timer);
      timer = setTimeout(refreshCounts, 300);
    };
    const unsubscribe = notifier.subscribe(userId, {
      onChange: async ({ event, id, delivery, load }) => {
        bumpCounts();
        const known = live.current.items.find((item) => item.id === id);
        if (event === "delete" || delivery.deleted_at) {
          setFeed((f) => ({ ...f, items: f.items.filter((item) => item.id !== id) }));
          return;
        }
        const resurfaced = known && time(delivery.notified_at) !== time(known.notifiedAt);
        if (event === "update" && known && !resurfaced) {
          setFeed((f) => ({
            ...f,
            items: f.items.map((item) => (item.id === id ? { ...item, ...deliveryPatch(delivery) } : item)),
          }));
          return;
        }
        // Off-page state changes (e.g. a bulk mark-all-read) only move counts; load fresh arrivals only.
        if (event === "update" && !known) {
          const fresh = !delivery.read_at && !delivery.archived_at && Date.now() - time(delivery.notified_at) < FRESH_MS;
          if (!fresh) return;
        }
        const notification = await load();
        const { view: currentView, appFilter: currentApp, scope: currentScope } = live.current;
        if (!notification || !inScope(notification, currentScope)) {
          setFeed((f) => ({ ...f, items: f.items.filter((item) => item.id !== id) }));
          return;
        }
        setFeed((f) => {
          const rest = f.items.filter((item) => item.id !== id);
          const visible = inView(notification, currentView, currentApp);
          return { ...f, items: visible ? sortFeed([notification, ...rest]) : rest };
        });
        const isNew = event === "insert" || (event === "update" && (!known || resurfaced));
        if (isNew && !notification.isRead) callbacks.current.onReceive?.(notification);
      },
      onStatus: (status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") callbacks.current.onError?.(error || new Error(status), "realtime");
      },
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [realtime, notifier, userId, refreshCounts]);

  const loadMore = useCallback(async () => {
    const last = feed.items[feed.items.length - 1];
    if (!notifier || !feedKey || !last || loadingMore) return;
    setLoadingMore(true);
    const rows = await notifier.list({ ...filters, before: last.notifiedAt, limit: pageSize });
    setLoadingMore(false);
    if (!rows) return;
    setFeed((f) => {
      if (f.key !== feedKey) return f;
      const seen = new Set(f.items.map((item) => item.id));
      return { ...f, items: [...f.items, ...rows.filter((row) => !seen.has(row.id))], hasMore: rows.length >= pageSize };
    });
  }, [notifier, feedKey, feed.items, filters, pageSize, loadingMore]);

  // Optimistic: apply locally, persist, and reload from the server if the write fails.
  const mutate = useCallback(
    async (ids, { patch, remove, persist, scope: errorScope }) => {
      const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
      if (!notifier || !list.length) return false;
      const unreadBefore = live.current.items.filter((item) => list.includes(item.id) && !item.isRead && !item.isArchived).length;
      setFeed((f) => ({
        ...f,
        items: remove?.(f)
          ? f.items.filter((item) => !list.includes(item.id))
          : f.items.map((item) => (list.includes(item.id) ? { ...item, ...patch } : item)),
      }));
      if (patch?.isRead || remove) {
        setCounts((c) => ({ ...c, total: Math.max(0, c.total - unreadBefore) }));
      }
      const ok = await persist(list);
      if (!ok) {
        callbacks.current.onError?.(new Error(`Couldn't update notifications (${errorScope}).`), errorScope);
        refresh();
        return false;
      }
      refreshCounts();
      return true;
    },
    [notifier, refresh, refreshCounts],
  );

  const now = () => new Date().toISOString();
  const markRead = useCallback(
    (ids) => mutate(ids, { scope: "markRead", patch: { readAt: now(), isRead: true }, persist: notifier?.markRead }),
    [mutate, notifier],
  );
  const markUnread = useCallback(
    (ids) => mutate(ids, { scope: "markUnread", patch: { readAt: null, isRead: false }, persist: notifier?.markUnread }),
    [mutate, notifier],
  );
  const archive = useCallback(
    (ids) =>
      mutate(ids, {
        scope: "archive",
        patch: { archivedAt: now(), isArchived: true },
        remove: () => live.current.view !== "archived",
        persist: notifier?.archive,
      }),
    [mutate, notifier],
  );
  const unarchive = useCallback(
    (ids) =>
      mutate(ids, {
        scope: "unarchive",
        patch: { archivedAt: null, isArchived: false },
        remove: () => live.current.view === "archived",
        persist: notifier?.unarchive,
      }),
    [mutate, notifier],
  );
  const dismiss = useCallback(
    (ids) => mutate(ids, { scope: "dismiss", remove: () => true, persist: notifier?.dismiss }),
    [mutate, notifier],
  );

  const markAllRead = useCallback(async () => {
    if (!notifier) return false;
    const targets = appFilter ? [appFilter] : scope.apps?.length ? scope.apps : [null];
    setFeed((f) => ({ ...f, items: f.items.map((item) => ({ ...item, isRead: true, readAt: item.readAt ?? now() })) }));
    setCounts((c) => (targets[0] === null ? { ...c, total: 0 } : c));
    const results = await Promise.all(
      targets.map((target) => notifier.markAllRead({ app: target, organizationId: scope.organizationId })),
    );
    if (results.some((count) => count === null)) {
      callbacks.current.onError?.(new Error("Couldn't mark notifications as read."), "markAllRead");
      refresh();
      return false;
    }
    refreshCounts();
    return true;
  }, [notifier, appFilter, scope, refresh, refreshCounts]);

  const markAllSeen = useCallback(async () => {
    if (!notifier || !userId || !counts.unseen) return;
    setCounts((c) => ({ ...c, unseen: 0 }));
    await notifier.markAllSeen();
  }, [notifier, userId, counts.unseen]);

  const loadPreferences = useCallback(async () => {
    if (!notifier) return;
    const rows = await notifier.listPreferences();
    setPreferences(rows ?? []);
  }, [notifier]);

  // muted=true writes a mute rule; muted=false removes it so broader rules apply again.
  const setMuted = useCallback(
    async (ruleScope = {}, muted = true, { until = null } = {}) => {
      if (!notifier) return false;
      const rule = { app: ANY, category: ANY, type: ANY, ...ruleScope };
      const same = (p) => p.app === rule.app && p.category === rule.category && p.type === rule.type;
      setPreferences((prev) => {
        const rest = (prev || []).filter((p) => !same(p));
        return muted ? [{ ...rule, id: null, muted: true, mutedUntil: until }, ...rest] : rest;
      });
      const ok = muted ? Boolean(await notifier.mute(rule, { until })) : await notifier.unmute(rule);
      if (!ok) {
        callbacks.current.onError?.(new Error("Couldn't save notification preferences."), "preferences");
        loadPreferences();
      }
      return ok;
    },
    [notifier, loadPreferences],
  );

  const isMuted = useCallback((target) => resolveMuted(preferences || [], target), [preferences]);
  const isRuleOn = useCallback((target) => isRuleMuted(findRule(preferences || [], target)), [preferences]);

  const visibleCounts = userId ? counts : EMPTY_COUNTS;
  const unreadCount = scope.apps?.length
    ? scope.apps.reduce((sum, key) => sum + (visibleCounts.apps[key] || 0), 0)
    : visibleCounts.total;
  const items = feed.key === feedKey ? feed.items : [];
  const loading = Boolean(notifier) && (userId === undefined || (Boolean(userId) && feed.key !== feedKey));

  const value = {
    notifier,
    app,
    userId: userId ?? null,
    signedIn: Boolean(userId),
    scope,
    view,
    setView,
    appFilter,
    setAppFilter,
    items,
    loading,
    loadingMore,
    hasMore: feed.key === feedKey && feed.hasMore,
    loadMore,
    refresh,
    counts: visibleCounts,
    unreadCount,
    markRead,
    markUnread,
    toggleRead: (item) => (item.isRead ? markUnread(item.id) : markRead(item.id)),
    archive,
    unarchive,
    dismiss,
    markAllRead,
    markAllSeen,
    preferences,
    loadPreferences,
    setMuted,
    isMuted,
    isRuleMuted: isRuleOn,
  };

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotificationsContext() {
  return useContext(NotificationsContext);
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error("useNotifications must be used inside <NotificationsProvider>");
  return context;
}

export function useUnreadCount() {
  return useContext(NotificationsContext)?.unreadCount ?? 0;
}

// The provider's notifier, for sending from client components.
export function useNotifier() {
  return useContext(NotificationsContext)?.notifier ?? null;
}
