import { createClient } from "@supabase/supabase-js";
import { createNotifier } from "./core/client.js";

// Trusted notifier on the service role: may notify anyone, set `actorId`/`actor`,
// and run without a user session (cron jobs, webhooks, server actions). Server-only.
export function createServerNotifier({
  supabase = null,
  url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  ...options
} = {}) {
  if (typeof window !== "undefined") {
    throw new Error("@geiger/notify/server must not be imported in the browser");
  }
  if (supabase) return createNotifier(supabase, options);
  if (!url || !serviceRoleKey) {
    console.error("[notify.server] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
    return null;
  }
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return createNotifier(client, options);
}

export { createNotifier } from "./core/client.js";
export { defineNotificationTypes } from "./core/registry.js";
