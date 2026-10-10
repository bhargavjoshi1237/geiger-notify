"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowLeft, Bell, BellOff, CheckCheck, Settings2 } from "lucide-react";
import { Button } from "@geiger/ui/button";
import { LogoLoading } from "@geiger/ui/logo-loading";
import { Popover, PopoverContent, PopoverTrigger } from "@geiger/ui/popover";
import { SegmentedTabs } from "@geiger/ui/segmented-tabs";
import { cn } from "@geiger/ui/lib/utils";
import { appInfo } from "../core/constants.js";
import { dayBucket } from "../core/time.js";
import { NotificationItem } from "./item.jsx";
import { NotificationPreferences } from "./preferences.jsx";
import { NotificationsProvider, useNotifications, useNotificationsContext } from "./provider.jsx";
import { defaultNavigate, safeHref } from "./utils.js";

const EMPTY_COPY = {
  all: { title: "You're all caught up", description: "New notifications from every Geiger app land here." },
  unread: { title: "No unread notifications", description: "Everything has been read." },
  archived: { title: "Nothing archived", description: "Archive a notification to keep it out of your inbox." },
};

// Lookup order: "<app>:<type>", "<app>:*", "<type>", "category:<category>".
function pickRenderer(renderers, notification) {
  if (!renderers) return null;
  return (
    renderers[`${notification.app}:${notification.type}`] ||
    renderers[`${notification.app}:*`] ||
    renderers[notification.type] ||
    renderers[`category:${notification.category}`] ||
    null
  );
}

function UnreadBadge({ count }) {
  if (!count) return null;
  return (
    <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-notification-dot px-1 text-[10px] font-semibold leading-none text-white tabular-nums">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function BellPanel({
  title = "Notifications",
  align = "end",
  sideOffset = 8,
  className,
  contentClassName,
  trigger,
  renderers,
  showAppFilter = true,
  showSettings = true,
  preferenceApps,
  preferenceCategories,
  onNavigate,
  onAction,
}) {
  const n = useNotifications();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState("inbox");

  const appsWithItems = useMemo(() => {
    const keys = new Set(Object.keys(n.counts.apps).filter((key) => !n.scope.apps?.length || n.scope.apps.includes(key)));
    for (const item of n.items) keys.add(item.app);
    if (n.appFilter) keys.add(n.appFilter);
    return [...keys].sort((a, b) => appInfo(a).label.localeCompare(appInfo(b).label));
  }, [n.counts.apps, n.items, n.appFilter, n.scope.apps]);

  const sections = useMemo(() => {
    const groups = [];
    for (const item of n.items) {
      const label = dayBucket(item.notifiedAt);
      const last = groups[groups.length - 1];
      if (last?.label === label) last.items.push(item);
      else groups.push({ label, items: [item] });
    }
    return groups;
  }, [n.items]);

  function handleOpenChange(next) {
    setOpen(next);
    if (next) n.markAllSeen();
    else setPanel("inbox");
  }

  function navigate(url, notification) {
    if (!safeHref(url)) return;
    setOpen(false);
    (onNavigate || defaultNavigate)(url, notification);
  }

  function openNotification(notification) {
    if (!notification.isRead) n.markRead(notification.id);
    if (notification.url) navigate(notification.url, notification);
  }

  // onAction may return true to take over; otherwise mark read and follow action.url.
  function runAction(notification, action) {
    if (onAction?.(notification, action) === true) return;
    if (action.markRead !== false && !notification.isRead) n.markRead(notification.id);
    if (action.url) navigate(action.url, notification);
  }

  const helpers = {
    open: openNotification,
    runAction,
    toggleRead: n.toggleRead,
    archive: (item) => (item.isArchived ? n.unarchive(item.id) : n.archive(item.id)),
    dismiss: (item) => n.dismiss(item.id),
    close: () => setOpen(false),
  };

  const empty = EMPTY_COPY[n.view] || EMPTY_COPY.all;
  const unreadTab = n.unreadCount ? `Unread (${n.unreadCount > 99 ? "99+" : n.unreadCount})` : "Unread";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={n.unreadCount ? `${title} (${n.unreadCount} unread)` : title}
            className={cn("relative rounded-full text-muted-foreground hover:text-foreground", className)}
          >
            <Bell className="size-[18px]" strokeWidth={2} />
            <UnreadBadge count={n.unreadCount} />
          </Button>
        )}
      </PopoverTrigger>

      <PopoverContent
        align={align}
        sideOffset={sideOffset}
        className={cn("w-[400px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl p-0", contentClassName)}
      >
        <div className="flex flex-col gap-3 border-b border-border px-4 pb-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {panel === "settings" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Back to notifications"
                  onClick={() => setPanel("inbox")}
                >
                  <ArrowLeft />
                </Button>
              ) : null}
              <h2 className="truncate text-[15px] font-semibold text-foreground">
                {panel === "settings" ? "Notification settings" : title}
              </h2>
            </div>
            {panel === "inbox" ? (
              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Mark all as read"
                  title="Mark all as read"
                  disabled={!n.unreadCount}
                  className="text-text-secondary hover:text-foreground"
                  onClick={() => n.markAllRead()}
                >
                  <CheckCheck className="size-4" />
                </Button>
                {showSettings ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Notification settings"
                    title="Notification settings"
                    className="text-text-secondary hover:text-foreground"
                    onClick={() => setPanel("settings")}
                  >
                    <Settings2 className="size-4" />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          {panel === "inbox" ? (
            <>
              <SegmentedTabs
                fullWidth
                value={n.view}
                onChange={n.setView}
                tabs={[
                  { label: "All", value: "all" },
                  { label: unreadTab, value: "unread" },
                  { label: "Archived", value: "archived" },
                ]}
              />
              {showAppFilter && appsWithItems.length > 1 ? (
                <div className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
                  {[null, ...appsWithItems].map((key) => {
                    const active = n.appFilter === key;
                    const count = key ? n.counts.apps[key] || 0 : n.unreadCount;
                    return (
                      <button
                        key={key ?? "all"}
                        type="button"
                        onClick={() => n.setAppFilter(key)}
                        className={cn(
                          "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors",
                          active
                            ? "border-border-strong bg-surface-active text-foreground"
                            : "border-border bg-surface-card text-text-secondary hover:bg-surface-hover hover:text-foreground",
                        )}
                      >
                        {key ? appInfo(key).label : "All apps"}
                        {count ? <span className="tabular-nums text-text-tertiary">{count}</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="max-h-[min(460px,calc(100vh-12rem))] overflow-y-auto overscroll-contain">
          {panel === "settings" ? (
            <NotificationPreferences apps={preferenceApps} categories={preferenceCategories} />
          ) : n.loading ? (
            <div className="flex justify-center py-14">
              <LogoLoading size={36} />
            </div>
          ) : !n.signedIn ? (
            <div className="px-6 py-14 text-center text-[13px] text-text-secondary">Sign in to see your notifications.</div>
          ) : !n.items.length ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <span className="flex size-10 items-center justify-center rounded-full border border-border bg-surface-card text-text-tertiary">
                <BellOff className="size-4" />
              </span>
              <p className="text-[13px] font-medium text-foreground">{empty.title}</p>
              <p className="text-[12px] text-text-secondary">{empty.description}</p>
            </div>
          ) : (
            <>
              {sections.map((section) => (
                <Fragment key={section.label}>
                  <p className="sticky top-0 z-10 border-b border-border/60 bg-surface-dialog/95 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider text-text-tertiary backdrop-blur">
                    {section.label}
                  </p>
                  <div className="divide-y divide-border/60">
                    {section.items.map((item) => {
                      const Custom = pickRenderer(renderers, item);
                      return Custom ? (
                        <Custom key={item.id} notification={item} helpers={helpers} />
                      ) : (
                        <NotificationItem
                          key={item.id}
                          notification={item}
                          showApp={!n.appFilter}
                          onOpen={openNotification}
                          onAction={runAction}
                          onToggleRead={n.toggleRead}
                          onArchive={helpers.archive}
                          onDismiss={helpers.dismiss}
                        />
                      );
                    })}
                  </div>
                </Fragment>
              ))}
              {n.hasMore ? (
                <div className="border-t border-border/60 p-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full text-text-secondary"
                    disabled={n.loadingMore}
                    onClick={n.loadMore}
                  >
                    {n.loadingMore ? "Loading…" : "Load older"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Suite bell. Inside a <NotificationsProvider> it uses that feed; standalone it
// builds its own from `supabase` (the app's session client) and provider props.
export function NotificationBell({ supabase, app, notifier, scope, pageSize, realtime, onReceive, onError, ...panelProps }) {
  const context = useNotificationsContext();
  if (context) return <BellPanel {...panelProps} />;
  return (
    <NotificationsProvider
      supabase={supabase}
      app={app}
      notifier={notifier}
      scope={scope}
      pageSize={pageSize}
      realtime={realtime}
      onReceive={onReceive}
      onError={onError}
    >
      <BellPanel {...panelProps} />
    </NotificationsProvider>
  );
}
