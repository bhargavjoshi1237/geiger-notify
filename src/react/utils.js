// Feed badges follow the suite rule: tailwind colour at /10 bg + /20 border.
export const TONE_STYLES = {
  neutral: "border-border bg-surface-card text-text-secondary",
  info: "border-blue-500/20 bg-blue-500/10 text-blue-400",
  success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  warning: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  danger: "border-red-500/20 bg-red-500/10 text-red-400",
};

export const PRIORITY_STYLES = {
  high: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  urgent: "border-red-500/20 bg-red-500/10 text-red-400",
};

// Only http(s) and root-relative links: notification URLs come from other users.
export function safeHref(url) {
  if (!url || typeof window === "undefined") return null;
  try {
    const target = new URL(url, window.location.origin);
    return target.protocol === "http:" || target.protocol === "https:" ? target : null;
  } catch {
    return null;
  }
}

// Root-relative links stay in the tab (they may cross suite apps on the shared origin);
// other origins open in a new tab.
export function defaultNavigate(url) {
  const target = safeHref(url);
  if (!target) return;
  if (target.origin === window.location.origin) window.location.assign(target.href);
  else window.open(target.href, "_blank", "noopener,noreferrer");
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "?").toUpperCase() + (parts[1]?.[0] || "").toUpperCase();
}
