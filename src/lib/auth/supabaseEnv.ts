// Supabase configuration resolution.
//
// Deliberately dependency-free (no `server-only`, no SDK) so the CLI checks and the
// unit tests can import it directly with `node --experimental-strip-types`, and so
// the server and the browser agree on one list of accepted variable names.
//
// WHY SO MANY ALIASES
// -------------------
// Vercel projects in the wild name these things differently:
//
//   SUPABASE_URL / SUPABASE_ANON_KEY            (server-side convention)
//   NEXT_PUBLIC_SUPABASE_URL / ..._ANON_KEY     (Supabase's dashboard snippet)
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY        (new-style sb_publishable_... keys)
//
// Only `NEXT_PUBLIC_*` is inlined into a browser bundle, which used to mean the
// browser silently broke when the variables were stored under any other name. The
// browser now fetches its public settings from /api/auth/settings, so any of these
// names works.

export const SUPABASE_URL_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_PROJECT_URL",
] as const;

export const SUPABASE_KEY_KEYS = [
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_KEY",
] as const;

export type SupabaseConfig = {
  url: string;
  /** Public browser key. Never the service-role key. */
  anonKey: string;
  urlSource: string;
  keySource: string;
};

export type SupabaseEnvProblem = {
  code: "missing-url" | "missing-key" | "bad-url" | "service-role-key";
  message: string;
};

function readEnv(env: Record<string, string | undefined>, keys: readonly string[]) {
  for (const key of keys) {
    const value = (env[key] ?? "").trim();
    if (value) return { value, source: key };
  }
  return null;
}

/** True when a key is the service-role key (which must never reach a browser). */
export function looksLikeServiceRoleKey(key: string): boolean {
  if (/service_role/.test(key)) return true;
  try {
    const payload = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64").toString("utf8"));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

/** New-style publishable keys are opaque: `sb_publishable_...`. */
export function looksLikePublishableKey(key: string): boolean {
  return key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
}

export type SupabaseEnvReport = {
  urlKeys: Array<{ key: string; present: boolean }>;
  keyKeys: Array<{ key: string; present: boolean }>;
};

/** Presence (never values) of every accepted variable, for diagnostics. */
export function supabaseEnvReport(
  env: Record<string, string | undefined> = process.env,
): SupabaseEnvReport {
  return {
    urlKeys: SUPABASE_URL_KEYS.map((key) => ({ key, present: Boolean((env[key] ?? "").trim()) })),
    keyKeys: SUPABASE_KEY_KEYS.map((key) => ({ key, present: Boolean((env[key] ?? "").trim()) })),
  };
}

/**
 * Resolve configuration, or explain precisely what is wrong.
 * Returns `{ config }` when usable, `{ problem }` when the variables exist but are
 * unusable, and `null` when Supabase simply is not configured.
 */
export function resolveSupabaseEnv(
  env: Record<string, string | undefined> = process.env,
): { config: SupabaseConfig; problem: null } | { config: null; problem: SupabaseEnvProblem } | null {
  const url = readEnv(env, SUPABASE_URL_KEYS);
  const key = readEnv(env, SUPABASE_KEY_KEYS);

  if (!url && !key) return null;

  if (!url) {
    return {
      config: null,
      problem: {
        code: "missing-url",
        message: `A Supabase key is set (${key?.source}) but no project URL. Set ${SUPABASE_URL_KEYS[0]} (e.g. https://<project-ref>.supabase.co).`,
      },
    };
  }
  if (!key) {
    return {
      config: null,
      problem: {
        code: "missing-key",
        message: `A Supabase URL is set (${url.source}) but no key. Set ${SUPABASE_KEY_KEYS[0]} with the anon/public key.`,
      },
    };
  }
  if (!/^https?:\/\//i.test(url.value)) {
    return {
      config: null,
      problem: {
        code: "bad-url",
        message: `${url.source} must start with https:// (got "${url.value}").`,
      },
    };
  }
  if (looksLikeServiceRoleKey(key.value) || key.value.startsWith("sb_secret_")) {
    return {
      config: null,
      problem: {
        code: "service-role-key",
        message:
          `${key.source} holds a service-role/secret key. That bypasses row-level security and ` +
          `must never be used by the app or sent to a browser. Replace it with the anon/public key ` +
          `(${SUPABASE_KEY_KEYS[0]}).`,
      },
    };
  }

  return {
    config: {
      url: url.value.replace(/\/+$/, ""),
      anonKey: key.value,
      urlSource: url.source,
      keySource: key.source,
    },
    problem: null,
  };
}
