import { jwtVerify, SignJWT } from "jose";
import type { JWTPayload } from "jose";
import { JOINT_OWNER_ROLE } from "./roles";

// Simulated TideCloak identity.
//
// WHY THIS EXISTS
// ---------------
// TideCloak is the real authentication system for this app: OIDC login, DPoP-bound
// tokens, realm roles, governed role changes. Standing it up needs Docker, a Tide
// licence and a reachable realm, which is not always available (demo machines,
// preview deployments, reviewers).
//
// This module simulates the *shape* of what TideCloak issues so the application can
// be built and reviewed exactly as if Tide protected it:
//
//   * three subjects with committed `account:joint-owner` realm roles;
//   * short-lived bearer tokens carrying realm_access / resource_access claims;
//   * server-side role enforcement on every protected route.
//
// WHAT IT IS NOT
// --------------
// No Tide cryptography, no ORK threshold, no QEA governance, no DPoP binding, no
// issuer the browser can reach. The HMAC secret below is a constant on purpose: this
// is a demo credential issuer, not a security boundary. Treat anything from here as
// unauthenticated the moment real data is involved.
//
// Switching to the real thing is configuration, not code: set the TideCloak adapter
// (CLIENT_ADAPTER / CLIENT_ADAPTER_B64 or data/tidecloak.json) and `authMode()`
// flips to "tidecloak", which makes this module refuse to mint or accept tokens.

const DEMO_SECRET =
  process.env.DEMO_AUTH_SECRET ?? "cosign-bank-simulated-identity-not-a-security-boundary";

const DEMO_ISSUER = "urn:cosign-bank:simulated-tidecloak";

export { JOINT_OWNER_ROLE };

export type DemoPersona = {
  /** Stable id used by the simulator UI */
  id: string;
  /** `sub` claim — the identity the server authorises */
  subject: string;
  username: string;
  givenName: string;
  email: string;
  /** Matches an owner id in data/bank-demo-db.seed.json */
  ownerId: string;
  title: string;
};

/**
 * Three co-owners, mirroring the seed database and the live demo script.
 * The third is the "admin" persona so the governed-role story has a face.
 */
export const DEMO_PERSONAS: DemoPersona[] = [
  {
    id: "admin-a",
    subject: "demo|owner-admin-a",
    username: "admin.a",
    givenName: "Admin A",
    email: "admin.a@cosign-bank.test",
    ownerId: "owner-admin-a",
    title: "Realm administrator · joint owner",
  },
  {
    id: "founder-b",
    subject: "demo|owner-founder-b",
    username: "founder.b",
    givenName: "Founder B",
    email: "founder.b@cosign-bank.test",
    ownerId: "owner-founder-b",
    title: "Joint owner",
  },
  {
    id: "founder-c",
    subject: "demo|owner-founder-c",
    username: "founder.c",
    givenName: "Founder C",
    email: "founder.c@cosign-bank.test",
    ownerId: "owner-founder-c",
    title: "Joint owner",
  },
];

export function findPersona(id: string): DemoPersona | undefined {
  return DEMO_PERSONAS.find((persona) => persona.id === id || persona.subject === id);
}

export function personaForSubject(subject: string | undefined): DemoPersona | undefined {
  if (!subject) return undefined;
  return DEMO_PERSONAS.find((persona) => persona.subject === subject);
}

/**
 * Mint a demo access token. Claim names deliberately mirror Keycloak/TideCloak so
 * the rest of the server (hasRole, displayNameFromToken) needs no special case.
 */
export async function signDemoToken(persona: DemoPersona, ttlSeconds = 60 * 60 * 2): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const resource = process.env.TIDECLOAK_RESOURCE ?? "cosign-bank-client";

  return new SignJWT({
    sub: persona.subject,
    preferred_username: persona.username,
    given_name: persona.givenName,
    email: persona.email,
    email_verified: true,
    typ: "Bearer",
    azp: resource,
    realm_access: { roles: [JOINT_OWNER_ROLE, "offline_access", "uma_authorization"] },
    resource_access: { [resource]: { roles: [JOINT_OWNER_ROLE] } },
    // Marks the token as simulated so any consumer can refuse it deliberately.
    cosign_bank_identity: "simulated",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(DEMO_ISSUER)
    .setAudience(resource)
    .setSubject(persona.subject)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(new TextEncoder().encode(DEMO_SECRET));
}

export class DemoIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoIdentityError";
  }
}

/**
 * Verify a simulated token. Same checks the real path applies where they are
 * meaningful (signature, issuer, audience, azp, expiry) minus DPoP, which has no
 * meaning without a real sender-constrained token.
 */
export async function verifyDemoToken(token: string): Promise<JWTPayload> {
  const resource = process.env.TIDECLOAK_RESOURCE ?? "cosign-bank-client";

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, new TextEncoder().encode(DEMO_SECRET), {
      issuer: DEMO_ISSUER,
      audience: resource,
    });
    payload = result.payload;
  } catch (error) {
    throw new DemoIdentityError(
      `Simulated token rejected: ${error instanceof Error ? error.message : "invalid"}`,
    );
  }

  if (payload.cosign_bank_identity !== "simulated") {
    throw new DemoIdentityError("Token was not issued by the simulator");
  }
  if (payload.azp !== resource) {
    throw new DemoIdentityError("Token azp does not match client");
  }

  // Deliberately no role check here. Authentication and authorisation are separate
  // concerns: a valid token without the role must reach `withRole` and receive 403,
  // not be rejected as an invalid credential (401).

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && payload.exp < now) {
    throw new DemoIdentityError("Token expired");
  }

  return payload;
}
