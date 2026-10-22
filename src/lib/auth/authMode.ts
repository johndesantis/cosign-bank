import "server-only";

import { tryLoadTideConfig } from "./tidecloakConfig";
import { supabaseConfigured } from "./supabaseIdentity";

/**
 * How this deployment authenticates. Precedence, highest first:
 *
 *  tidecloak     — a TideCloak adapter resolves: OIDC login plus DPoP-bound tokens.
 *  supabase      — NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY are set:
 *                  email/password accounts in Supabase Auth (`auth.users`).
 *  simulated     — neither, but DEMO_AUTH is not "0": the local simulator.
 *  unconfigured  — nothing at all: protected routes answer 503.
 *
 * Configuration wins over the simulator, so adding Supabase credentials silently
 * retires the demo identity instead of running two identity systems at once.
 */
export type AuthMode = "tidecloak" | "supabase" | "simulated" | "unconfigured";

export function demoAuthEnabled(): boolean {
  return process.env.DEMO_AUTH !== "0" && process.env.DEMO_AUTH !== "false";
}

export function authMode(): AuthMode {
  const { config } = tryLoadTideConfig();
  if (config) return "tidecloak";
  if (supabaseConfigured()) return "supabase";
  return demoAuthEnabled() ? "simulated" : "unconfigured";
}

/** Human-readable explanation for logs, API payloads and the UI banner. */
export function authModeDescription(mode: AuthMode = authMode()): string {
  switch (mode) {
    case "tidecloak":
      return "TideCloak OIDC with server-side JWT and DPoP verification";
    case "supabase":
      return "Supabase Auth email/password accounts, verified server-side on every request";
    case "simulated":
      return "Simulated TideCloak identity: sign-in, roles and access checks are simulated";
    default:
      return "Authentication is not configured";
  }
}
