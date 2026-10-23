"use client";

import { Archive, ArchiveRestore, Check, Circle, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@geiger/ui/avatar";
import { Button } from "@geiger/ui/button";
import { LucideIcon } from "@geiger/ui/icon-picker";
import { cn } from "@geiger/ui/lib/utils";
import { appInfo, categoryInfo } from "../core/constants.js";
import { formatFullTime, formatRelativeTime } from "../core/time.js";
import { PRIORITY_STYLES, TONE_ICON_STYLES, initials } from "./utils.js";

function Leading({ notification }) {
  const icon = notification.icon || categoryInfo(notification.category).icon;
  const tone = TONE_ICON_STYLES[notification.tone] || TONE_ICON_STYLES.neutral;
  const image = notification.imageUrl || notification.actor?.avatarUrl;

  if (!image && !notification.actor?.name) {
    return (
      <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background", tone)}>
        <LucideIcon name={icon} className="size-4" strokeWidth={1.8} />
      </div>
    );
  }

  return (
    <div className="relative size-8 shrink-0">
      <Avatar className="size-8">
        {image ? <AvatarImage src={image} alt="" /> : null}
        <AvatarFallback className="border border-border bg-background text-[11px] text-muted-foreground">
          {initials(notification.actor?.name)}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          "absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-background",
          tone,
        )}
      >
        <LucideIcon name={icon} className="size-2.5" strokeWidth={2.2} />
      </span>
    </div>
  );
}

function RowAction({ label, onClick, children }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:bg-surface-active hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </Button>
  );
}

// Default feed row. Apps can swap it per type via the bell's `renderers` prop.
export function NotificationItem({
  notification,
  onOpen,
  onAction,
  onToggleRead,
  onArchive,
  onDismiss,
  showApp = true,
  className,
}) {
  const unread = !notification.isRead;
  const source = appInfo(notification.app);
  const flagged = PRIORITY_STYLES[notification.priority];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(notification)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.(notification);
        }
      }}
      className={cn(
        "group relative flex cursor-pointer gap-3 rounded-lg px-2.5 py-2.5 outline-none transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover",
        className,
      )}
    >
      <Leading notification={notification} />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p
            className={cn(
              "line-clamp-2 text-[13px] leading-snug",
              unread ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {notification.title}
          </p>
          <span className="mt-px flex shrink-0 items-center gap-1.5 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
            <time
              dateTime={notification.notifiedAt || undefined}
              title={formatFullTime(notification.notifiedAt)}
              className="text-[11px] tabular-nums text-text-secondary"
            >
              {formatRelativeTime(notification.notifiedAt)}
            </time>
            {unread ? <span aria-hidden className="size-1.5 rounded-full bg-notification-dot" /> : null}
          </span>
        </div>

        {notification.body ? (
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{notification.body}</p>
        ) : null}

        {notification.actions.length ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {notification.actions.map((action, index) => (
              <Button
                key={action.id || action.label || index}
                type="button"
                size="xs"
                variant={action.variant === "primary" ? "default" : "outline"}
                onClick={(event) => {
                  event.stopPropagation();
                  onAction?.(notification, action);
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-text-secondary">
          {showApp ? (
            <span className="inline-flex shrink-0 items-center gap-1">
              <LucideIcon name={source.icon} className="size-3" />
              {source.label}
            </span>
          ) : null}
          {notification.actor?.name ? (
            <>
              {showApp ? <span aria-hidden>·</span> : null}
              <span className="truncate">{notification.actor.name}</span>
            </>
          ) : null}
          {flagged ? (
            <span className={cn("ml-auto shrink-0 rounded-md border px-1.5 py-px text-[10px] font-medium capitalize", flagged)}>
              {notification.priority}
            </span>
          ) : null}
        </div>
      </div>

      {/* Same surface as the hovered row, so the actions read as part of it rather than a floating toolbar. */}
      <div className="absolute right-1.5 top-1.5 hidden items-center gap-0.5 rounded-md bg-surface-hover group-hover:flex group-focus-within:flex">
        {onToggleRead ? (
          <RowAction label={unread ? "Mark as read" : "Mark as unread"} onClick={() => onToggleRead(notification)}>
            {unread ? <Check /> : <Circle />}
          </RowAction>
        ) : null}
        {onArchive ? (
          <RowAction label={notification.isArchived ? "Move to inbox" : "Archive"} onClick={() => onArchive(notification)}>
            {notification.isArchived ? <ArchiveRestore /> : <Archive />}
          </RowAction>
        ) : null}
        {onDismiss ? (
          <RowAction label="Dismiss" onClick={() => onDismiss(notification)}>
            <X />
          </RowAction>
        ) : null}
      </div>
    </div>
  );
}
