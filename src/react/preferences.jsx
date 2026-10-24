"use client";

import { useEffect } from "react";
import { BellRing, Volume2 } from "lucide-react";
import { LucideIcon } from "@geiger/ui/icon-picker";
import { LogoLoading } from "@geiger/ui/logo-loading";
import { Switch } from "@geiger/ui/switch";
import { cn } from "@geiger/ui/lib/utils";
import { CATEGORIES, appInfo, categoryInfo } from "../core/constants.js";
import { useNotifications } from "./provider.jsx";

const DEFAULT_APPS = ["dash", "notes", "flow", "events", "forms", "content", "assets", "pods"];
const DEFAULT_CATEGORIES = Object.keys(CATEGORIES);

function PreferenceRow({ icon, label, description, checked, disabled, onCheckedChange }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-hover",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-card text-text-secondary">
        {typeof icon === "string" ? <LucideIcon name={icon} className="size-3.5" /> : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-foreground">{label}</span>
        {description ? <span className="block text-[11px] text-text-tertiary">{description}</span> : null}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} aria-label={label} />
    </label>
  );
}

function SectionLabel({ children }) {
  return (
    <p className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">{children}</p>
  );
}

// Per-user mute rules: a master switch, the sound switch, then per-app and per-category switches.
// Switches read "enabled"; turning one off writes a mute rule, on removes it. Sound is per browser, not a rule.
export function NotificationPreferences({ apps = DEFAULT_APPS, categories = DEFAULT_CATEGORIES, className }) {
  const { preferences, loadPreferences, setMuted, isRuleMuted, sound, soundEnabled, setSoundEnabled } = useNotifications();

  useEffect(() => {
    if (preferences === null) loadPreferences();
  }, [preferences, loadPreferences]);

  if (preferences === null) {
    return (
      <div className="flex justify-center py-12">
        <LogoLoading size={36} />
      </div>
    );
  }

  const paused = isRuleMuted({});

  return (
    <div className={cn("flex flex-col pb-2", className)}>
      <PreferenceRow
        icon={<BellRing className="size-3.5" />}
        label="Allow notifications"
        description={paused ? "Paused: only urgent notifications get through." : "Across every Geiger app."}
        checked={!paused}
        onCheckedChange={(on) => setMuted({}, !on)}
      />
      {sound ? (
        <PreferenceRow
          icon={<Volume2 className="size-3.5" />}
          label="Play a sound"
          description="When a notification arrives, on this device."
          checked={soundEnabled}
          onCheckedChange={setSoundEnabled}
        />
      ) : null}

      {apps.length ? <SectionLabel>Apps</SectionLabel> : null}
      {apps.map((key) => {
        const info = appInfo(key);
        return (
          <PreferenceRow
            key={key}
            icon={info.icon}
            label={info.label}
            checked={!isRuleMuted({ app: key })}
            disabled={paused}
            onCheckedChange={(on) => setMuted({ app: key }, !on)}
          />
        );
      })}

      {categories.length ? <SectionLabel>Categories</SectionLabel> : null}
      {categories.map((key) => {
        const info = categoryInfo(key);
        return (
          <PreferenceRow
            key={key}
            icon={info.icon}
            label={info.label}
            checked={!isRuleMuted({ category: key })}
            disabled={paused}
            onCheckedChange={(on) => setMuted({ category: key }, !on)}
          />
        );
      })}
    </div>
  );
}
