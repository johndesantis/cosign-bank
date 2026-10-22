import type { Metadata } from "next";
import { headers } from "next/headers";
import { Providers, SimulatedProviders, SupabaseProviders } from "./providers";
import { PreviewMode } from "./preview-mode";
import { ConfigWarnings } from "./config-warnings";
import { SimulatedIdentityBanner } from "./simulated-identity-banner";
import { tryLoadTideConfig, adapterDiagnostics } from "@/lib/auth/tidecloakConfig";
import { authMode } from "@/lib/auth/authMode";
import { supabaseConfigProblem } from "@/lib/auth/supabaseIdentity";
import "./globals.css";

// Authentication is resolved per request:
//
//   adapter present      → real TideCloak (OIDC, DPoP-bound tokens, realm roles)
//   Supabase configured  → email/password accounts in Supabase Auth
//   neither, DEMO_AUTH≠0 → simulated identity
//   nothing at all       → preview/configuration page
//
// The adapter is deployment configuration (adapter env vars or data/tidecloak.json,
// gitignored), so rendering is dynamic rather than frozen at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CoSign Bank",
  description: "Remote joint-account withdrawals protected by Tide policy signing",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolved on the server and handed to the client provider as a prop, so no
  // client bundle ever statically imports data/tidecloak.json.
  // The request hostname decides whether a localhost auth-server-url is a broken
  // deployment or simply local development.
  const host = (await headers()).get("host");
  const { config, error, warnings } = tryLoadTideConfig(host);
  const mode = authMode();
  // A half-configured Supabase project must not look like "Supabase is on": say which
  // variable is missing while the simulator serves the request.
  const supabaseProblem = supabaseConfigProblem();

  return (
    <html lang="en">
      <body>
        {config ? (
          <Providers config={config}>
            {warnings.length > 0 && <ConfigWarnings warnings={warnings} />}
            {children}
          </Providers>
        ) : mode === "supabase" ? (
          <SupabaseProviders>{children}</SupabaseProviders>
        ) : mode === "simulated" ? (
          <SimulatedProviders>
            <SimulatedIdentityBanner />
            {supabaseProblem && (
              <div
                role="alert"
                style={{
                  padding: "12px 24px",
                  background: "#ffe0d8",
                  borderBottom: "1px solid #f1a99b",
                  color: "#8e2f25",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                <strong>Supabase is incomplete on this deployment.</strong>{" "}
                {supabaseProblem.message}
              </div>
            )}
            {children}
          </SimulatedProviders>
        ) : (
          <PreviewMode message={error} diagnostic={adapterDiagnostics()} />
        )}
      </body>
    </html>
  );
}
