import { adapterDiagnostics, deploymentInfo, loadTideConfig, tideConfigWarnings, isHostedDeployment } from "@/lib/auth/tidecloakConfig";
import { authMode, authModeDescription } from "@/lib/auth/authMode";
import { DEMO_PERSONAS } from "@/lib/auth/demo-identity";
import { supabaseSummary } from "@/lib/auth/supabaseIdentity";

// Auth configuration endpoint.
//
//   tidecloak → 200 with the adapter (public client + realm public keys) for
//               server-side consumers, plus warnings and deployment identity.
//   supabase  → 200 with a non-secret summary (project URL, role-grant policy).
//   simulated → 200 with the simulated mode and its personas; no adapter exists.
//   unconfigured → 500 with the error text and the deployment diagnostic.
//
// `deployment` answers "which Vercel project/environment/commit is serving me?".
export const dynamic = "force-dynamic";

export async function GET() {
  const deployment = deploymentInfo();
  const mode = authMode();

  if (mode === "supabase") {
    return Response.json(
      {
        authMode: mode,
        description: authModeDescription(mode),
        supabase: supabaseSummary(),
        notice:
          "Sign-in and registration use Supabase Auth email/password accounts. Passwords are " +
          "hashed by Supabase and never reach this application.",
        deployment,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (mode === "simulated") {
    return Response.json(
      {
        authMode: mode,
        description: authModeDescription(mode),
        notice:
          "No TideCloak adapter is configured. Identity, roles and access checks are " +
          "simulated by /api/demo-auth; switch to real TideCloak by setting " +
          "CLIENT_ADAPTER (or CLIENT_ADAPTER_B64).",
        personas: DEMO_PERSONAS.map(({ id, givenName, ownerId, title }) => ({
          id,
          givenName,
          ownerId,
          title,
        })),
        deployment,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const config = loadTideConfig();
    const warnings = tideConfigWarnings(config, {
      // A route handler has no browser hostname; trust the platform signal.
      servedFromLocalhost: !isHostedDeployment(),
    });
    return Response.json({ ...config, authMode: mode, warnings, deployment });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Config not found",
        authMode: mode,
        deployment,
        diagnostics: adapterDiagnostics(),
      },
      { status: 500 }
    );
  }
}
