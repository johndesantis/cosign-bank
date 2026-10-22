"use client";

import { TideCloakProvider } from "@tidecloak/nextjs";
import type { TidecloakConfig } from "@/lib/auth/tidecloakConfig";
import { ProfileOnboarding } from "@/components/ProfileOnboarding";
import { DemoBridge, RealBridge } from "@/lib/tide/bridge";
import { SupabaseBridge } from "@/lib/tide/supabaseBridge";

// Auth providers. The app talks to `useTideCloak()` from "@/lib/tide/bridge", which
// is backed by one of two implementations:
//
//   config present → real TideCloak (OIDC logins, DPoP-bound tokens, realm roles)
//   config absent  → simulated identity (DEMO_AUTH, default on) so the app can be
//                    built and reviewed exactly as if Tide protected it
//
// Playbook: add-auth-nextjs-fresh Step 4a — useDPoP goes inside the config object,
// not as a separate JSX prop; it enables client-side DPoP proof generation, which
// the server verifies in src/lib/auth/protect.ts.
//
// The adapter JSON is resolved on the server (env var or data/tidecloak.json) and
// passed in as a prop. Do NOT statically import data/tidecloak.json here: that file
// is gitignored, so a clean checkout — Vercel, CI, a new machine — has no such
// module and `next build` fails to resolve it.
export function Providers({
  config,
  children,
}: {
  config: TidecloakConfig;
  children: React.ReactNode;
}) {
  return (
    <TideCloakProvider
      config={{ ...config, useDPoP: { mode: "strict", alg: "ES256" } }}
    >
      <RealBridge>
        {children}
        <ProfileOnboarding
          baseUrl={config["auth-server-url"].replace(/\/+$/, "")}
          realm={config.realm}
        />
      </RealBridge>
    </TideCloakProvider>
  );
}

/**
 * Providers for Supabase email/password accounts (`authMode() === "supabase"`).
 * The screens, hooks and role checks are identical to the other two backends.
 */
export function SupabaseProviders({ children }: { children: React.ReactNode }) {
  return <SupabaseBridge>{children}</SupabaseBridge>;
}

/**
 * Providers for the simulated identity. Same children, same hook surface, no
 * TideCloak SDK in the tree — and no ProfileOnboarding, which talks to a Keycloak
 * account API that does not exist here.
 */
export function SimulatedProviders({ children }: { children: React.ReactNode }) {
  return <DemoBridge>{children}</DemoBridge>;
}
