"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser Supabase client.
//
// The URL and anon key come from /api/auth/settings rather than from
// `process.env.NEXT_PUBLIC_*`, because NEXT_PUBLIC variables are inlined at build
// time: if the project's variables were stored under SUPABASE_URL / SUPABASE_ANON_KEY
// (a very common convention), the server would work while the browser silently broke.
// Fetching settings at runtime makes every accepted variable name work.
//
// The anon key is public by design; the service-role key is refused server-side and
// never sent here. Sessions live in sessionStorage so three owners can be signed in
// in three tabs and a shared browser profile does not retain a token.

export type PublicSupabaseSettings = {
  url: string;
  anonKey: string;
  urlSource?: string;
  keySource?: string;
};

let client: SupabaseClient | null = null;
let pending: Promise<SupabaseClient> | null = null;

async function loadSettings(): Promise<PublicSupabaseSettings> {
  const response = await fetch("/api/auth/settings", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load authentication settings (HTTP ${response.status})`);
  }
  const body = (await response.json()) as {
    authMode?: string;
    supabase?: PublicSupabaseSettings | null;
    problem?: { message?: string };
  };

  if (!body.supabase) {
    throw new Error(
      body.problem?.message ??
        "Supabase is not configured on this deployment. Set NEXT_PUBLIC_SUPABASE_URL and " +
          "NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_URL / SUPABASE_ANON_KEY) and redeploy.",
    );
  }
  return body.supabase;
}

export function getSupabaseBrowserClient(): Promise<SupabaseClient> {
  if (client) return Promise.resolve(client);
  if (pending) return pending;

  pending = loadSettings()
    .then((settings) => {
      client = createClient(settings.url, settings.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce",
          storage: typeof window === "undefined" ? undefined : window.sessionStorage,
        },
      });
      return client;
    })
    .catch((error) => {
      pending = null;
      throw error;
    });

  return pending;
}
