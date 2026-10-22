"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTideCloak as useRealTideCloak } from "@tidecloak/nextjs";

// A single `useTideCloak()` surface backed by either the real TideCloak SDK or the
// simulated identity. Application components import THIS module, never
// `@tidecloak/nextjs` directly, so the screens contain no auth-mode branching.
//
// Real mode:  <TideCloakProvider config={...}> wraps <RealBridge>, which forwards the
//             SDK's context value.
// Simulated:  <DemoBridge> issues tokens from /api/demo-auth and mimics the same
//             methods (login opens a persona picker instead of redirecting to a realm).

export type SimulatedPersona = {
  id: string;
  subject: string;
  username: string;
  givenName: string;
  email: string;
  ownerId: string;
  title: string;
};

export type TideAuth = {
  mode: "tidecloak" | "supabase" | "simulated";
  authenticated: boolean;
  isInitializing: boolean;
  token: string | null;
  persona: SimulatedPersona | null;
  login: () => void;
  logout: () => void;
  /** Mirrors the SDK: string claim values, undefined when absent. */
  getValueFromToken: (key: string) => string | undefined;
  getValueFromIdToken: (key: string) => string | undefined;
  secureFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const TideAuthContext = createContext<TideAuth | null>(null);

/**
 * Wrapper around the shared context, so additional identity backends (Supabase)
 * can provide the same `useTideCloak()` surface without importing this module's
 * implementation components.
 */
export function TideAuthProvider({
  value,
  children,
}: {
  value: TideAuth;
  children: ReactNode;
}) {
  return <TideAuthContext.Provider value={value}>{children}</TideAuthContext.Provider>;
}

function asClaim(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : String(value);
}

export function useTideCloak(): TideAuth {
  const value = useContext(TideAuthContext);
  if (!value) {
    throw new Error(
      "useTideCloak must be used inside <Providers> (src/app/providers.tsx). " +
        "Those providers select real TideCloak or the simulated identity.",
    );
  }
  return value;
}

/** Real TideCloak: forward the SDK value, keeping the same shape. */
export function RealBridge({ children }: { children: ReactNode }) {
  const real = useRealTideCloak() as unknown as {
    authenticated?: boolean;
    isInitializing?: boolean;
    token?: string | null;
    login: () => void;
    logout: () => void;
    getValueFromToken?: (key: string) => unknown;
    getValueFromIdToken?: (key: string) => unknown;
    secureFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  };

  const value = useMemo<TideAuth>(
    () => ({
      mode: "tidecloak",
      authenticated: Boolean(real.authenticated),
      isInitializing: Boolean(real.isInitializing),
      token: real.token ?? null,
      persona: null,
      login: real.login,
      logout: real.logout,
      getValueFromToken: (key) => asClaim(real.getValueFromToken?.(key)),
      getValueFromIdToken: (key) =>
        asClaim((real.getValueFromIdToken ?? real.getValueFromToken)?.(key)),
      secureFetch: real.secureFetch,
    }),
    [real],
  );

  return <TideAuthContext.Provider value={value}>{children}</TideAuthContext.Provider>;
}

const STORAGE_KEY = "cosign-bank.simulated-identity";

type StoredIdentity = { token: string; persona: SimulatedPersona };

function decodeClaims(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Simulated identity. Logging in opens a persona picker (the equivalent of the
 * realm login page), stores the issued token for the tab, and every request carries
 * it as a Bearer token so the server exercises its real role checks.
 */
export function DemoBridge({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [personas, setPersonas] = useState<SimulatedPersona[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Restore a previous tab session so a reload does not silently sign you out.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredIdentity;
        if (parsed?.token) setIdentity(parsed);
      }
    } catch {
      // ignore corrupt storage
    }
    setIsInitializing(false);
  }, []);

  useEffect(() => {
    if (!chooserOpen || personas.length > 0) return;
    fetch("/api/demo-auth", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { personas?: SimulatedPersona[] }) => setPersonas(body.personas ?? []))
      .catch(() => setError("Could not load the simulated identities"));
  }, [chooserOpen, personas.length]);

  const login = useCallback(() => {
    setError(null);
    setChooserOpen(true);
  }, []);

  const logout = useCallback(() => {
    setIdentity(null);
    setChooserOpen(false);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const choosePersona = useCallback(
    async (personaId: string) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/demo-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personaId }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? "Simulated sign-in failed");
        const next: StoredIdentity = { token: body.token, persona: body.persona };
        setIdentity(next);
        setChooserOpen(false);
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Simulated sign-in failed");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const claims = useMemo(
    () => (identity ? decodeClaims(identity.token) : null),
    [identity],
  );

  const secureFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (identity?.token) headers.set("Authorization", `Bearer ${identity.token}`);
      return fetch(input, { ...init, headers });
    },
    [identity],
  );

  const value = useMemo<TideAuth>(
    () => ({
      mode: "simulated",
      authenticated: Boolean(identity),
      isInitializing,
      token: identity?.token ?? null,
      persona: identity?.persona ?? null,
      login,
      logout,
      getValueFromToken: (key) => asClaim(claims?.[key]),
      getValueFromIdToken: (key) => asClaim(claims?.[key]),
      secureFetch,
    }),
    [identity, isInitializing, claims, login, logout, secureFetch],
  );

  return (
    <TideAuthContext.Provider value={value}>
      {children}
      {chooserOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Simulated sign-in">
          <div className="modal-card">
            <span className="card-kicker">Simulated TideCloak</span>
            <h2>Choose a joint owner</h2>
            <p>
              This deployment has no TideCloak adapter, so sign-in is simulated. Each identity
              gets a token with the <code>account:joint-owner</code> role and the server still
              enforces roles on every protected route.
            </p>
            {error && <p className="form-error">{error}</p>}
            <div style={{ display: "grid", gap: 10, margin: "22px 0" }}>
              {personas.length === 0 && !error && <p>Loading identities…</p>}
              {personas.map((persona) => (
                <button
                  key={persona.id}
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => choosePersona(persona.id)}
                  style={{ justifyContent: "space-between", width: "100%" }}
                >
                  <span>{persona.givenName}</span>
                  <small style={{ color: "var(--muted)", fontWeight: 600 }}>{persona.title}</small>
                </button>
              ))}
            </div>
            <div className="button-row">
              <button type="button" className="button ghost" onClick={() => setChooserOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </TideAuthContext.Provider>
  );
}
