"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser Supabase client.
//
// The anon key is public by design (it is the browser key; row access is governed by
// RLS, and password handling happens inside Supabase's auth server). The service
// role key must never be used here — it bypasses RLS and would let the browser mint
// anything.
//
// Sessions are kept in sessionStorage rather than localStorage: the demo needs three
// different owners signed in simultaneously (three tabs), and a token left behind in
// a shared browser profile is a worse default than one that dies with the tab.

let client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
        "must be set at build time for the browser client.",
    );
  }

  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window === "undefined" ? undefined : window.sessionStorage,
    },
  });
  return client;
}
