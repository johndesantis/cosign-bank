// Role constants and the server-side role-grant decision.
//
// Deliberately dependency-free (no `server-only`, no SDK imports) so it can be
// unit-tested directly under `node --test` and imported from any identity backend.

export const JOINT_OWNER_ROLE = "account:joint-owner";

/**
 * Parse `JOINT_OWNER_EMAILS` ("ada@x.com, bob@y.com").
 * An empty list means the demo-open policy: any authenticated account is an owner.
 */
export function parseAllowlist(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Roles for a verified email.
 *
 * Only two inputs are trusted: the email taken from a token the server has already
 * validated, and server-side configuration. Nothing the browser sends (roles,
 * metadata, headers) influences this.
 */
export function resolveRoles(email: string | undefined, allowlist: string[]): string[] {
  if (allowlist.length === 0) return [JOINT_OWNER_ROLE];
  if (!email) return [];
  return allowlist.includes(email.trim().toLowerCase()) ? [JOINT_OWNER_ROLE] : [];
}
