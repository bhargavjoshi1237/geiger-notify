// Postgres schema owning the notification tables (owned by geiger-dash migrations).
export const NOTIFY_SCHEMA = "notify";

export const TONES = ["neutral", "info", "success", "warning", "danger"];
export const PRIORITIES = ["low", "normal", "high", "urgent"];
export const VIEWS = ["all", "unread", "archived"];

// Wildcard used by mute rules for "any app / category / type".
export const ANY = "*";

// Cross-suite buckets: drive bell grouping and mute rules. Apps may send others.
export const CATEGORIES = {
  general: { label: "General", icon: "Bell" },
  mention: { label: "Mentions", icon: "AtSign" },
  comment: { label: "Comments", icon: "MessageSquare" },
  assignment: { label: "Assignments", icon: "UserCheck" },
  invite: { label: "Invites", icon: "MailPlus" },
  reminder: { label: "Reminders", icon: "AlarmClock" },
  update: { label: "Updates", icon: "RefreshCw" },
  alert: { label: "Alerts", icon: "TriangleAlert" },
  billing: { label: "Billing", icon: "CreditCard" },
  security: { label: "Security", icon: "ShieldCheck" },
  system: { label: "System", icon: "Info" },
};

// Suite products a notification can come from; `href` is the app's root path on geiger.studio.
export const SUITE_APPS = {
  dash: { label: "Dash", icon: "LayoutDashboard", href: "/org" },
  notes: { label: "Notes", icon: "NotebookPen", href: "/notes" },
  flow: { label: "Flow", icon: "Workflow", href: "/flow" },
  events: { label: "Events", icon: "CalendarDays", href: "/events" },
  forms: { label: "Forms", icon: "ClipboardList", href: "/forms" },
  content: { label: "Content", icon: "Newspaper", href: "/content" },
  assets: { label: "Assets", icon: "FolderOpen", href: "/assets" },
  pods: { label: "Pods", icon: "Boxes", href: "/pods" },
  campaign: { label: "Campaign", icon: "Megaphone", href: "/campaign" },
  comms: { label: "Comms", icon: "MessagesSquare", href: "/comms" },
  docs: { label: "Docs", icon: "FileText", href: "/docs" },
  grey: { label: "Grey", icon: "Sparkles", href: "/grey" },
  property: { label: "Property", icon: "House", href: "/property" },
};

function humanize(value) {
  const text = String(value || "").replace(/[-_.]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

// Display info for an app or category id. Ids outside the suite lists still render:
// the label is humanized from the id ("time_off" → "Time off") with a generic icon.
export function appInfo(app) {
  return SUITE_APPS[app] || { label: humanize(app) || "App", icon: "AppWindow", href: null };
}

export function categoryInfo(category) {
  return CATEGORIES[category] || { label: humanize(category) || "General", icon: "Bell" };
}
