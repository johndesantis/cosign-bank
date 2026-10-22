import "server-only";

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { JWTPayload } from "jose";
import { JOINT_OWNER_ROLE, parseAllowlist, resolveRoles } from "./roles";
import {
  resolveSupabaseEnv,
  supabaseEnvReport,
  type SupabaseConfig,
  type SupabaseEnvProblem,
} from "./supabaseEnv";

// Supabase email/password identity.
//
// WHAT THIS DOES
// --------------
// Verifies Supabase access tokens server-side and maps them onto the same claim
// shape the rest of the app already authorises against (`sub`, `realm_access`,
// `preferred_username`). Application code, roles and routes do not change when you
// switch from TideCloak or the simulator to Supabase.
//
// WHAT IT DOES NOT DO — ON PURPOSE
// --------------------------------
// It never receives, stores or hashes passwords. Sign-up and sign-in happen in the
// browser against Supabase's GoTrue auth server, which stores a bcrypt hash of the
// password in the `auth.users` table. Passwords never touch this codebase, our API
// routes or any table we own. Anyone asking to "save the passwords in a table"
// should get hashes managed by the auth server, not plaintext — this is that.
//
// CONFIG
// ------
//   NEXT_PUBLIC_SUPABASE_URL       https://<project-ref>.supabase.co
//   NEXT_PUBLIC_SUPABASE_ANON_KEY  the project's anon (public) key
//
// Optional:
//   JOINT_OWNER_EMAILS=ada@x.com,bob@y.com   restrict the joint-owner role to a list
//   SUPABASE_JWT_SECRET / SUPABASE_JWKS_URL  (unused: we verify with the auth server)

export { JOINT_OWNER_ROLE, resolveRoles };

export type { SupabaseConfig };

/** Usable configuration, or null when absent/misconfigured. */
export function getSupabaseConfig(): SupabaseConfig | null {
  const resolved = resolveSupabaseEnv(process.env);
  return resolved?.config ?? null;
}

/** Present-but-unusable configuration (missing half, service-role key, bad URL). */
export function supabaseConfigProblem(): SupabaseEnvProblem | null {
  const resolved = resolveSupabaseEnv(process.env);
  return resolved?.problem ?? null;
}

export function supabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

/**
 * Parsed `JOINT_OWNER_EMAILS`; empty means "any authenticated user" (demo-open).
 *
 * The real realm grants roles through governed administration; here the grant is
 * either an allowlist you control or, when unset, every authenticated account, so
 * registration works out of the box. Either way the decision is server-side and
 * derived from the verified token (see ./roles.ts), never from the request body.
 */
export function jointOwnerAllowlist(): string[] {
  return parseAllowlist(process.env.JOINT_OWNER_EMAILS);
}

export class SupabaseIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseIdentityError";
  }
}

// Verifying with the auth server costs a round trip; cache the result briefly so a
// dashboard poll (every few seconds) does not hammer it. Keyed by token digest, so
// no raw token is kept as a map key.
const VERIFY_TTL_MS = 30_000;
const verificationCache = new Map<string, { payload: JWTPayload; expiresAt: number }>();

function digest(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function claimsForUser(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): JWTPayload {
  const metadata = user.user_metadata ?? {};
  const fullName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : undefined;
  const givenName =
    typeof metadata.given_name === "string"
      ? metadata.given_name
      : fullName?.split(" ")[0] ?? user.email?.split("@")[0];

  const roles = resolveRoles(user.email ?? undefined, jointOwnerAllowlist());
  const resource = process.env.TIDECLOAK_RESOURCE ?? "cosign-bank-client";
  const now = Math.floor(Date.now() / 1000);

  return {
    // The Supabase user id is the stable subject: approvals, face profiles and
    // audit rows key off it exactly as they do a Tide subject.
    sub: user.id,
    preferred_username: user.email ?? user.id,
    email: user.email ?? undefined,
    given_name: givenName,
    name: fullName,
    azp: resource,
    iss: "supabase",
    iat: now,
    realm_access: { roles },
    resource_access: { [resource]: { roles } },
    cosign_bank_identity: "supabase",
  };
}

/**
 * Verify a Supabase access token and return TideCloak-shaped claims.
 * Throws SupabaseIdentityError when the token is missing, expired or forged.
 */
export async function verifySupabaseToken(token: string): Promise<JWTPayload> {
  const config = getSupabaseConfig();
  if (!config) {
    throw new SupabaseIdentityError("Supabase is not configured on this deployment");
  }
  if (!token) throw new SupabaseIdentityError("Missing access token");

  const key = digest(token);
  const cached = verificationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  let user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null } | null;
  try {
    const { data, error } = await client.auth.getUser(token);
    if (error) {
      // Distinguish "the token is invalid" from "we cannot ask the auth server".
      // The SDK surfaces transport failures as AuthRetryableFetchError (status 0).
      const name = (error as { name?: string }).name ?? "";
      const status = (error as { status?: number }).status;
      const transporty =
        name === "AuthRetryableFetchError" ||
        status === 0 ||
        /fetch failed|network|ECONNREFUSED|ENOTFOUND|timed? ?out/i.test(error.message);
      throw new SupabaseIdentityError(
        transporty
          ? `Could not reach Supabase to verify the token: ${error.message}`
          : `Supabase rejected the token: ${error.message}`,
      );
    }
    user = data.user;
  } catch (error) {
    if (error instanceof SupabaseIdentityError) throw error;
    throw new SupabaseIdentityError(
      `Could not reach Supabase to verify the token: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  if (!user) throw new SupabaseIdentityError("Supabase returned no user for this token");

  const payload = claimsForUser(user);
  if (verificationCache.size > 500) verificationCache.clear();
  verificationCache.set(key, { payload, expiresAt: Date.now() + VERIFY_TTL_MS });
  return payload;
}

/** Non-secret summary for /api/config and the UI banner. */
export function supabaseSummary() {
  const config = getSupabaseConfig();
  const allowlist = jointOwnerAllowlist();
  const problem = supabaseConfigProblem();
  return {
    configured: config !== null,
    url: config?.url ?? null,
    urlSource: config?.urlSource ?? null,
    keySource: config?.keySource ?? null,
    problem: problem?.code ?? null,
    problemMessage: problem?.message ?? null,
    roleGrant: allowlist.length > 0 ? "allowlist" : "any-authenticated-user",
    allowlistSize: allowlist.length,
    env: supabaseEnvReport(process.env),
  };
}
