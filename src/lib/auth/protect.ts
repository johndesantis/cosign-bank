import { NextRequest } from "next/server";
import { verifyTideJWT, hasRole, extractToken } from "./tideJWT";
import { verifyDpop } from "./verifyDpop";
import { verifyDemoToken } from "./demo-identity";
import { SupabaseIdentityError, verifySupabaseToken } from "./supabaseIdentity";
import { authMode } from "./authMode";
import type { JWTPayload } from "jose";

// Playbook: verify-jwt-server-side Step 5
//
// One door, three implementations behind it:
//
//   tidecloak  → verify the Tide JWT signature/issuer/azp AND the DPoP binding.
//                A stolen token replays as a bare Bearer unless the proof is checked
//                (AP-43), so both are required.
//   supabase   → ask Supabase's auth server whether the access token is live and
//                derive roles from the verified email. No DPoP: Supabase tokens are
//                not sender-constrained, so replay protection is expiry + TLS only.
//   simulated  → verify the simulator's HMAC token. No DPoP either. The mode is
//                reported in API responses so a client can tell the difference.
//
// Route handlers never branch on the mode; they receive a verified JWTPayload and
// run the same role checks either way. That is the point: swapping the simulator for
// Supabase or TideCloak changes configuration, not application code.
type AuthHandler = (req: NextRequest, jwt: JWTPayload) => Promise<Response>;

export function withAuth(handler: AuthHandler) {
  return async (req: NextRequest) => {
    try {
      const mode = authMode();

      if (mode === "unconfigured") {
        return Response.json(
          {
            error:
              "Authentication is not configured on this deployment. Set Supabase " +
              "(NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY), a TideCloak adapter " +
              "(CLIENT_ADAPTER / CLIENT_ADAPTER_B64), or enable the simulator with DEMO_AUTH=1.",
            authMode: mode,
          },
          { status: 503 },
        );
      }

      const token = extractToken(req.headers.get("authorization"));

      if (mode === "supabase") {
        const jwt = await verifySupabaseToken(token);
        return handler(req, jwt);
      }

      if (mode === "simulated") {
        const jwt = await verifyDemoToken(token);
        return handler(req, jwt);
      }

      const jwt = await verifyTideJWT(token);
      await verifyDpop(req, token, jwt as { cnf?: { jkt?: string } });
      return handler(req, jwt);
    } catch (err) {
      // A provider outage is not the caller's fault: say so instead of a bare 401.
      const unreachable =
        err instanceof SupabaseIdentityError && /Could not reach Supabase/.test(err.message);
      return Response.json(
        { error: err instanceof Error ? err.message : "Unauthorized" },
        { status: unreachable ? 503 : 401 }
      );
    }
  };
}

export function withRole(role: string, handler: AuthHandler) {
  return withAuth(async (req, jwt) => {
    if (!hasRole(jwt, role)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    return handler(req, jwt);
  });
}
