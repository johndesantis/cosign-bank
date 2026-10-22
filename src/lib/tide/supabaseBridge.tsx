"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { TideAuthProvider, type TideAuth } from "@/lib/tide/bridge";

// Supabase email/password identity, exposed through the same context shape the rest
// of the app consumes from "@/lib/tide/bridge". Screens never learn which provider
// they are running against.
//
// Passwords are only ever sent from this form to Supabase's auth server over HTTPS.
// They are not logged, not persisted by this app, and never reach our API routes.

type Mode = "signin" | "signup" | "check-email";

export function SupabaseBridge({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  // Restore and subscribe to the session. The client is created from runtime
  // settings (/api/auth/settings), so no NEXT_PUBLIC_* build-time inlining is needed.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    getSupabaseBrowserClient()
      .then(async (supabase) => {
        if (cancelled) return;
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        setSession(data.session);
        setIsInitializing(false);

        const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
          setSession(next);
          if (event === "SIGNED_IN") {
            setOpen(false);
            setPassword("");
            setError(null);
          }
          if (event === "SIGNED_OUT") setSession(null);
        });
        unsubscribe = () => subscription.subscription.unsubscribe();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setInitializationError(err instanceof Error ? err.message : "Authentication is unavailable");
        setIsInitializing(false);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const login = useCallback(() => {
    setMode("signin");
    setError(null);
    setNotice(null);
    // Surface a configuration problem instead of an empty modal.
    if (initializationError) {
      setError(initializationError);
    }
    setOpen(true);
  }, [initializationError]);

  const logout = useCallback(() => {
    void getSupabaseBrowserClient()
      .then((supabase) => supabase.auth.signOut())
      .catch(() => undefined);
    setOpen(false);
  }, []);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);
      setNotice(null);

      const cleanEmail = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        setError("Enter a valid email address");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters");
        return;
      }

      setBusy(true);
      let supabase;
      try {
        supabase = await getSupabaseBrowserClient();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authentication is unavailable");
        setBusy(false);
        return;
      }
      try {
        if (mode === "signup") {
          const { data, error: signUpError } = await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
              data: { full_name: fullName.trim() || undefined },
              emailRedirectTo:
                typeof window === "undefined" ? undefined : `${window.location.origin}/`,
            },
          });
          if (signUpError) throw signUpError;

          if (data.session) {
            setOpen(false);
            setPassword("");
          } else {
            // Email confirmation is enabled on the project: no session until the
            // link is clicked. Say so rather than pretending sign-in succeeded.
            setMode("check-email");
          }
          return;
        }

        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (signInError) throw signInError;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Authentication failed";
        setError(
          /email not confirmed/i.test(message)
            ? "That account exists but its email is not confirmed yet. Open the confirmation link Supabase sent, then sign in."
            : message,
        );
      } finally {
        setBusy(false);
      }
    },
    [email, password, fullName, mode],
  );

  const claims = useMemo(() => {
    const metadata = (session?.user?.user_metadata ?? {}) as Record<string, unknown>;
    return {
      sub: session?.user?.id,
      email: session?.user?.email,
      preferred_username: session?.user?.email ?? session?.user?.id,
      given_name:
        (typeof metadata.given_name === "string" ? metadata.given_name : undefined) ??
        (typeof metadata.full_name === "string" ? metadata.full_name.split(" ")[0] : undefined) ??
        session?.user?.email?.split("@")[0],
      name: typeof metadata.full_name === "string" ? metadata.full_name : undefined,
    } as Record<string, unknown>;
  }, [session]);

  const secureFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      // Refresh if the access token is close to expiry, so a long approval window
      // does not fail on a stale token.
      let token: string | undefined;
      try {
        const supabase = await getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token;
      } catch {
        // No credentials available: let the request proceed unauthenticated and the
        // server answer 401/503 with its own explanation.
      }
      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    },
    [],
  );

  const value = useMemo<TideAuth>(
    () => ({
      mode: "supabase",
      authenticated: Boolean(session),
      isInitializing,
      token: session?.access_token ?? null,
      persona: null,
      login,
      logout,
      getValueFromToken: (key) => {
        const claim = claims[key];
        return typeof claim === "string" ? claim : undefined;
      },
      getValueFromIdToken: (key) => {
        const claim = claims[key];
        return typeof claim === "string" ? claim : undefined;
      },
      secureFetch,
    }),
    [session, isInitializing, login, logout, claims, secureFetch],
  );

  return (
    <TideAuthProvider value={value}>
      {children}
      {open && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Sign in">
          <div className="modal-card">
            <span className="card-kicker">
              {mode === "signup" ? "Create an account" : "Secure sign in"}
            </span>
            <h2>{mode === "signup" ? "Register with email" : "Sign in with email"}</h2>

            {mode === "check-email" ? (
              <>
                <p>
                  Check <strong>{email}</strong> for a confirmation link. Your account exists in
                  Supabase; sign-in is enabled once the address is confirmed.
                </p>
                <p style={{ color: "var(--muted)", fontSize: 12 }}>
                  Any email provider works — the address is only used as your account
                  identifier.
                </p>
                <div className="button-row">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setMode("signin");
                      setNotice(null);
                    }}
                  >
                    Back to sign in
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={submit}>
                <label className="field">
                  <span>Email</span>
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                  />
                </label>

                {mode === "signup" && (
                  <label className="field">
                    <span>Full name (optional)</span>
                    <input
                      type="text"
                      name="name"
                      autoComplete="name"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      placeholder="Linh Tran"
                    />
                  </label>
                )}

                <label className="field">
                  <span>Password</span>
                  <input
                    type="password"
                    name="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                  />
                </label>

                {error && <p className="form-error">{error}</p>}
            {initializationError && !error && (
              <p className="form-error">{initializationError}</p>
            )}
                {notice && <p style={{ color: "var(--forest)", fontSize: 12 }}>{notice}</p>}

                <p style={{ color: "var(--muted)", fontSize: 11, lineHeight: 1.5 }}>
                  Accounts are stored in Supabase Auth. Your password is hashed by Supabase and
                  is never stored, logged or transmitted to this application&apos;s own servers.
                </p>

                <div className="button-row">
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => setOpen(false)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="button dark" disabled={busy}>
                    {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
                  </button>
                </div>

                <p style={{ marginTop: 16, fontSize: 13 }}>
                  {mode === "signup" ? (
                    <>
                      Already registered?{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setMode("signin");
                          setError(null);
                        }}
                        style={{ border: 0, background: "none", color: "var(--forest)", fontWeight: 700, cursor: "pointer", padding: 0 }}
                      >
                        Sign in
                      </button>
                    </>
                  ) : (
                    <>
                      New here?{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setMode("signup");
                          setError(null);
                        }}
                        style={{ border: 0, background: "none", color: "var(--forest)", fontWeight: 700, cursor: "pointer", padding: 0 }}
                      >
                        Create an account
                      </button>
                    </>
                  )}
                </p>
              </form>
            )}
          </div>
        </div>
      )}
    </TideAuthProvider>
  );
}
