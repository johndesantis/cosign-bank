"use client";

import { useTideCloak } from "@/lib/tide/bridge";

export default function HomePage() {
  const { authenticated, getValueFromIdToken, login, logout, isInitializing, mode } = useTideCloak();

  if (isInitializing) {
    return <main className="center-screen"><div className="loader" />Loading secure bank session…</main>;
  }

  const displayName =
    getValueFromIdToken("given_name") ||
    getValueFromIdToken("preferred_username") ||
    "joint owner";

  return (
    <main>
      <nav className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">C</span>
          <span>CoSign Bank</span>
        </a>
        <div className="nav-actions">
          <span className="nav-label">Joint account security</span>
          {authenticated ? (
            <button className="button ghost small" onClick={logout}>Sign out</button>
          ) : (
            <button className="button dark small" onClick={login}>{mode === "supabase" ? "Sign in" : "Secure sign in"}</button>
          )}
        </div>
      </nav>

      <section className="bank-hero">
        <div className="bank-hero-copy">
          <span className="eyebrow light">RMIT Hackathon 2026 · Challenge 2</span>
          <h1>Joint withdrawals.<br />No branch visit.</h1>
          <p>
            One owner requests. Two other co-owners approve remotely. Tide policy signing is
            designed to refuse the transaction unless every security condition passes.
          </p>
          <div className="hero-actions">
            {authenticated ? (
              <a className="button lime" href="/dashboard">Open joint account <span>→</span></a>
            ) : (
              <button className="button lime" onClick={login}>
                {mode === "supabase" ? "Sign in or create an account" : mode === "simulated" ? "Sign in (simulated)" : "Sign in with Tide"} <span>→</span>
              </button>
            )}
            <a className="button glass" href="#security">See security model</a>
          </div>
          {authenticated && <p className="welcome-line">Secure session ready for {displayName}.</p>}
        </div>

        <div className="phone-stage" aria-label="Joint withdrawal approval preview">
          <div className="phone-card phone-back">
            <span className="phone-kicker">Approval request</span>
            <strong>₫25,000,000</strong>
            <p>Future Fund · •••• 2048</p>
            <div className="face-check"><span>LT</span><div><b>Linh</b><small>Independent approval</small></div><em>Waiting</em></div>
            <div className="face-check"><span>AP</span><div><b>An</b><small>Independent approval</small></div><em>Waiting</em></div>
          </div>
          <div className="phone-card phone-front">
            <div className="phone-status"><span>9:41</span><span>Secure</span></div>
            <div className="mini-brand"><span>C</span> CoSign</div>
            <p className="phone-label">Available balance</p>
            <strong className="phone-balance">₫240,000,000</strong>
            <div className="owner-stack"><span>MN</span><span>LT</span><span>AP</span><small>3 co-owners</small></div>
            <div className="withdraw-card"><span>New withdrawal</span><b>2 approvals required</b><small>Requester cannot self-approve</small></div>
          </div>
        </div>
      </section>

      <section className="trust-row" id="security">
        <article><span>01</span><div><strong>Verified identity</strong><p>Real TideCloak OIDC login with strict DPoP token binding.</p></div></article>
        <article><span>02</span><div><strong>Two independent owners</strong><p>Proposed Forseti policy excludes the requester and requires two distinct VUIDs.</p></div></article>
        <article><span>03</span><div><strong>Threshold signature</strong><p>Once deployed, ORKs sign only when the contract permits the exact withdrawal payload.</p></div></article>
      </section>

      <section className="honesty-section">
        <div><span className="eyebrow">Prototype boundary</span><h2>Security claims you can verify.</h2></div>
        <div className="boundary-grid">
          <article className="boundary-card real"><span>Live now</span><h3>Tide login, JWT and DPoP</h3><p>The server rejects missing, invalid or replayable credentials. Browser-supplied roles are ignored.</p></article>
          <article className="boundary-card prepared"><span>Prepared</span><h3>2-of-3 withdrawal contract</h3><p>The contract source and local policy tests are included. Tide team deployment is still required.</p></article>
          <article className="boundary-card pending"><span>Demo only</span><h3>Local movement check</h3><p>MediaPipe checks a blink and randomized head turn on-device. It stores no face template and is not certified identity or anti-deepfake proof.</p></article>
        </div>
      </section>

      <footer className="footer"><span>CoSign Bank · Synthetic money only</span><span>Built with TideCloak</span></footer>
    </main>
  );
}
