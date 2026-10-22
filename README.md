# CoSign Bank

A synthetic joint-account prototype for RMIT Hackathon 2026 — UNLOCKED, Challenge 2. It is not connected to a real bank and must not be used for real money.

## Project overview

### 1. Vision & originality

CoSign Bank turns an in-branch, three-signature withdrawal into a remote flow. One joint owner creates a precise withdrawal request; the other two approve independently; only then may a threshold signature be produced. The interface makes the trust state visible instead of hiding it behind a generic “pending” screen.

### 2. Trust constraint insight

A conventional banking app and its administrator can become a unilateral gatekeeper. Co-owners must trust the operator not to add a new privileged user or bypass approval records. This prototype configures three Tide realm administrators, so governed role changes require two independent approvals instead of one.

### 3. Value & impact

Families, small businesses and community funds could approve urgent payments remotely without coordinating a branch visit. A short, explicit approval window improves convenience while preserving collective control.

### 4. Why TideCloak matters

TideCloak provides real OIDC login, DPoP-bound tokens, server-verifiable roles and QEA governance. The live setup proved one administrator leaves a role grant at `1/2`; a second linked administrator is required. The included Forseti contract is prepared for future ORK enforcement but is not deployed.

### 5. Prototype & storytelling

Three co-owners sign in through Tide and enroll three numeric face embeddings under their verified Tide subjects. Approval requires a MediaPipe blink and randomized head turn, followed by a server-side match against that owner’s enrolled profile. Images and video are not saved. The backend excludes the requester and rejects duplicates. At `2/2`, the UI displays synthetic success; this remains application-layer approval, not a Tide signature or transfer.

## Implemented now

- Official Tide Agent Pack Next.js foundation with `@tidecloak/nextjs@0.14.17`.
- Strict DPoP in the browser and JWT + DPoP verification on every protected API.
- Three linked Tide users with committed `account:joint-owner` roles.
- Three Tide realm administrators and a verified `2-of-3` QEA threshold for governed changes.
- English bank interface, synthetic VND account and a shared approval inbox that refreshes every four seconds.
- Per-owner face enrollment using three FaceRes embeddings tied to the verified Tide subject; images and video are not saved.
- MediaPipe blink plus randomized head-turn challenge before enrollment and every approval.
- Server-side face comparison rejects missing profiles and browser-supplied match claims; a wrong-Founder match cancels the whole synthetic request and blocks further approvals.
- Server-side application quorum: requester excluded, duplicate approval rejected, two distinct Tide subjects required.
- Automatic **Demo withdrawal successful** dialog after the second valid approval; no bank API is called and no balance or real funds move.
- Forseti C# contract, policy manifest, local parity tests and dual-shape compile test.
- Honest separation between the working application demo and the undeployed future Forseti signing path.

## Local setup

### Prerequisites

- macOS with Docker Desktop installed **and its engine running**.
- Node.js 20.9 or later, npm, `curl`, `jq` and Python 3.
- A real licence email and your own acceptance of [Tide Terms & Conditions](https://tide.org/legal).

This project was verified on an Apple Silicon Mac with Node `22.22.2`, npm `10.9.7` and Docker Desktop Engine `29.9.2`. Docker reported by this README is the user's Mac engine, not a cloud container.

### Install

```bash
npm install
mkdir -p .tide-pack
curl -fsSL "https://mcp.tide.org/pack/templates.tgz" | tar -xz -C .tide-pack
cp .env.example .env
```

Edit `.env`. Set a strong `KC_BOOTSTRAP_ADMIN_PASSWORD`, your real `TIDE_LICENSE_EMAIL`, and `TIDE_TERMS_ACCEPTED=yes` only after personally accepting the terms. Never commit `.env`.

If `docker` is not found in a new Mac terminal:

```bash
export PATH="$HOME/.docker/bin:$PATH"
docker info
```

### Bootstrap TideCloak

> `npm run init` recreates the local TideCloak container and H2 state. Back up existing state first. Do not run it merely to restart an enrolled realm.

```bash
npm run init
```

Open the one-time enrollment link printed by the script and complete it yourself. Do not paste passwords, recovery data or verification codes into chat. A fresh setup derives realm `cosign-bank` and client `cosign-bank-client` from `package.json`.

### Start and reset demo data

```bash
npm run reset
npm run dev
```

Open `http://localhost:3000`. Reset only the synthetic bank database at any time with `npm run reset`; the earlier research demo files are left untouched.

For the three-person demo, prepare separate browser profiles before creating the request:

- normal browser profile: Admin A;
- Chrome Guest or Incognito: Founder B;
- Safari Private or another isolated browser profile: Founder C.

All three open `http://localhost:3000` and sign in with their own Tide identity. Create the withdrawal only after all dashboards are ready because the approval window is 180 seconds.

Before recording, each founder opens **Co-owners → Enroll my face**, completes the blink/head-turn challenge and saves their own profile. `npm run reset` keeps these profiles while resetting synthetic transactions. To explicitly delete all local biometric embeddings, run:

```bash
npm run reset:faces
```

## Authentication modes

The app has one `useTideCloak()` surface (`src/lib/tide/bridge.tsx`) with two backends, chosen
at request time by `authMode()`:

| Mode | When (precedence top-down) | Sign-in | Server access checks | DPoP |
| :--- | :--- | :--- | :--- | :--- |
| `tidecloak` | an adapter resolves (`CLIENT_ADAPTER*` or `data/tidecloak.json`) | real Tide OIDC | `verifyTideJWT` + `withRole` | verified |
| `supabase` | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` set | **email + password, any provider** | `verifySupabaseToken` + `withRole` | n/a |
| `simulated` | neither of the above, `DEMO_AUTH` not `0` | persona picker, signed demo token | `verifyDemoToken` + `withRole` | not applicable |
| `unconfigured` | nothing configured and `DEMO_AUTH=0` | disabled | 503 with a configuration hint | — |

Route handlers never branch on the mode: they receive a verified `JWTPayload` and run the same
`withRole("account:joint-owner")` checks either way. Swapping the simulator for TideCloak is
configuration, not application code.

### Email + password accounts (Supabase)

Registration and sign-in with **any** email provider, stored in Supabase.

```bash
# 1. Create a project at https://supabase.com/dashboard
#    Authentication → Providers → Email: keep "Enable email provider" on.
#    (Email confirmation is optional; if on, users must click the link before
#     signing in — the form tells them so.)
# 2. Project Settings → API → copy the Project URL and the `anon` / `public` key
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>

npm run check:supabase     # validates URL, key type, provider state
```

Set the same two variables in Vercel (**Production and Preview**) and redeploy. Environment
variable changes never apply to an existing deployment, so a new build is required.

Accepted variable names (the browser gets its settings from `/api/auth/settings`, so **any** of
these works — `NEXT_PUBLIC_*` inlining is no longer required):

| Purpose | Accepted names |
| :--- | :--- |
| Project URL | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL`, `SUPABASE_PROJECT_URL` |
| Public key | `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_KEY` |

A service-role/secret key in any of those names is **refused**: the app falls back to the
simulator and the page shows "Supabase is incomplete on this deployment" with the reason, rather
than shipping a key that bypasses row-level security to browsers.

**How passwords are handled — read this before promising anything to a reviewer.**

- Sign-up and sign-in run **browser → Supabase** over HTTPS. Supabase Auth (GoTrue) stores the
  account in `auth.users` as `email` + a **bcrypt hash** of the password.
- This application never receives, logs or stores a password or a hash. Its API only ever sees
  the short-lived access token, and verifies that token with Supabase before serving data.
- There is no `passwords` table here, by design. A table of plaintext (or even app-hashed)
  passwords would be a liability with no upside over the provider's vetted implementation.
- Use the **anon** key in `NEXT_PUBLIC_*`. The service-role key bypasses row-level security and
  must stay server-side; `npm run check:supabase` refuses it.

Roles: `JOINT_OWNER_EMAILS=ada@x.com,bob@y.com` restricts `account:joint-owner` to those
addresses (403 for anyone else). Leave it unset for the demo-open policy where every
authenticated account is a joint owner — the decision is always made server-side from the
verified token, never from the request body.

Optional profile mirror (display names, RLS-protected):
`supabase/migrations/0001_profiles.sql`. Credentials are unaffected by it.

New accounts are keyed by their Supabase user id as the token subject, so approvals, face
enrollment and audit rows work exactly as they do with Tide subjects. The seeded owners panel
still lists the three demo owners; a newly registered user can create and approve requests but
will not appear in that static list.

### Where TideCloak fits, and what the simulator stands in for

| Capability | Real TideCloak mechanism | Status now |
| :--- | :--- | :--- |
| Browser sign-in | OIDC authorization code + PKCE against the realm | **simulated** — or real email/password accounts via Supabase in `supabase` mode |
| Token integrity | Realm-signed JWT; server verifies signature, issuer, `azp`, expiry | **simulated** (HMAC, same claim shape, same checks) |
| Sender-constrained tokens | `cnf.jkt` + RFC 9449 DPoP proof verified per request | **simulated: absent** (nothing to bind) |
| Roles / authorisation | `realm_access.roles` incl. `account:joint-owner` | **enforced for real** in `withRole` |
| Governed role changes | QEA 2-of-3 threshold on admin grants | **not simulated** (documented UI copy only) |
| Withdrawal signing | Forseti contract + ORK threshold signature | **not deployed** (unchanged) |

Because sign-in, token verification and role enforcement are simulated, **the simulator is not a
security boundary**. Its HMAC secret is a constant in the source. It exists so the product can be
built and reviewed; every screen it touches is covered by the SIMULATED IDENTITY banner, and
`/api/config` reports `authMode: "simulated"`.

Switching to the real thing:

```bash
# 1. Stand TideCloak up and export its adapter
npm run init                     # Docker + Tide licence + your acceptance of the terms
# 2. Deploy the adapter (see the deployment section below)
npm run verify:auth && npm run deploy
```

The moment an adapter resolves, `/api/demo-auth` returns 404, simulated tokens are rejected, and
`authMode` becomes `tidecloak`.

### Simulated data storage

`data/bank-demo-db.json` and `data/face-profiles.json` persist on a writable filesystem. On a
read-only host (Vercel), the app seeds itself from `data/*.seed.json` and keeps changes in memory
for the life of the instance; `/api/account` reports `syntheticStore: "file" | "memory"` so the UI
never implies durability it does not have.

## Deploying to Vercel (or any hosted Node host)

`data/tidecloak.json` is gitignored: it is environment-specific and is written by `npm run init`, so a hosted build checkout never contains it. The app resolves the adapter on the server at request time and passes it to the client provider as a prop, so a clean checkout builds and a missing config produces an explanation page rather than a crash.

### One command (recommended)

On the machine that ran `npm run init`:

```bash
npm run deploy            # upload adapter to Production/Preview/Development, then deploy
npm run deploy -- --dry-run   # show what it will do, change nothing
```

It validates the adapter, uploads it as `CLIENT_ADAPTER` and `CLIENT_ADAPTER_B64`, and runs
`vercel --prod`. It uses your own `vercel login` and refuses to deploy an adapter whose
`auth-server-url` is loopback (see below) unless you pass `--force`.

### Manual / inspect

```bash
npm run deploy:check
```

`deploy:check` validates the adapter and prints the exact `vercel env add` commands, already filled in:

```bash
npm run deploy:check
# ✓ Adapter found in data/tidecloak.json
# ✓ Required fields present (realm, auth-server-url, resource, jwk)
# ... then either run the printed commands, or paste the value by hand
```

Manual equivalent: Vercel → **Settings → Environment Variables** → add `CLIENT_ADAPTER` (single-line JSON from `jq -c . data/tidecloak.json`) for **Production and Preview**, then **redeploy** — environment variable changes never apply to existing deployments.

Supported variables, in priority order:

| Variable | Use |
| :--- | :--- |
| `CLIENT_ADAPTER` | the adapter as single-line JSON |
| `TIDECLOAK_ADAPTER` | alias, same format |
| `CLIENT_ADAPTER_B64` | base64 of the adapter — use when a dashboard mangles multi-line JSON (`base64 -w0 data/tidecloak.json`) |

A base64 value pasted into `CLIENT_ADAPTER` also works. Never commit `data/tidecloak.json`.

### Sign-in needs a publicly reachable TideCloak

The adapter written by `npm run init` points at `http://localhost:8080`. That URL only resolves on the machine running the container, so a hosted deployment cannot complete sign-in no matter which variable holds the adapter. The app detects this: when served from a real hostname it shows a banner explaining the problem instead of hanging on login, and `npm run deploy:check` exits non-zero for the same reason.

If TideCloak is not publicly reachable, run the demo locally — that is the intended deployment mode for this prototype.

### Hosting TideCloak publicly (needed for sign-in on the public URL)

TideCloak is a Keycloak-based server, so it needs a DNS name, TLS and a reachable port — the
same as any auth server. One path:

1. **Run the container on a host with a public name.** On a VPS (or Fly/Render/Railway),
   put TLS in front with Caddy:
   ```
   tidecloak.example.com {
       reverse_proxy 127.0.0.1:8080
   }
   ```
2. **Bootstrap with the public URL so the realm's issuer matches it.** This is the step that
   makes the adapter usable; without it the exported `auth-server-url` stays `localhost`:
   ```bash
   TIDECLOAK_HOSTNAME=https://tidecloak.example.com \
   CLIENT_APP_URL=https://your-app.vercel.app \
   ./scripts/init-tidecloak.sh
   ```
   `KC_HOSTNAME` and `KC_PROXY_HEADERS=xforwarded` are passed to the container automatically
   when `TIDECLOAK_HOSTNAME` uses `https://`.
3. **Verify before deploying** — this talks to the live realm:
   ```bash
   npm run verify:auth
   ```
   It checks HTTPS, discovery, that `discovery.issuer` equals the adapter's
   `<auth-server-url>/realms/<realm>`, and that the adapter's `jwk` kids are among the keys
   the realm currently publishes. Exit code 1 means a browser would fail; the message names
   the fix (usually `KC_HOSTNAME`, DNS, or a stale export).
4. **Upload the adapter and deploy:**
   ```bash
   npm run deploy
   ```

Notes:

- **Preview deployments:** the realm's redirect URIs come from `CLIENT_APP_URL`, so preview
  URLs (`https://cosign-bank-git-<branch>-<team>.vercel.app`) are not covered. Test sign-in
  on the production URL, or add the preview origins in the Tide console / realm client.
- **`npm run verify:auth -- --allow-local`** is the escape hatch for a self-hosted LAN
  setup; it downgrades the loopback/`http://` checks to warnings.
- Keep the adapter out of Git in every case; `npm run verify:auth` and `npm run deploy` both
  read it from `data/tidecloak.json` or the environment.

### Diagnostics

The setup page and `GET /api/config` both return a **deployment diagnostic**: which adapter
variables exist in *that* deployment, whether each parses, its length, plus the platform,
Vercel project ID, branch and commit. That answers "I set it, why is it missing?" without
guessing. The table below is the short version.

| Symptom | Meaning |
| :--- | :--- |
| Supabase keys added in Vercel, site still shows the SIMULATED IDENTITY banner, `/api/config` → `supabaseEnv` all `false` | The variables are not present in **this** build. Check the Vercel project ID (see below), the environment scope (Production vs Preview), and redeploy. |
| `/api/config` → `supabaseProblem.code: "missing-key"` or `"missing-url"` | Only half the pair is set. |
| `supabaseProblem.code: "service-role-key"` | A secret key is in a public variable. Swap in the anon/public key. |
| "No TideCloak adapter config found…" page, all sources `not set` | Nothing reached this deployment. Check the project ID on the page matches the project you edited, the environment scope (Production vs Preview vs Development), and redeploy. Variables are not passed to fork PR builds. |
| A variable listed `invalid` | The paste was mangled or truncated. Use `CLIENT_ADAPTER_B64`. |
| A variable listed `empty (0 chars)` | The variable exists with no value. |
| All sources valid, yet login fails | `auth-server-url` is loopback or `http://` — see the next section. |

### Preview mode (no adapter configured)

When no adapter resolves, the app renders the real landing page with a **Preview mode** banner
instead of an error: sign-in and the approval dashboard are visibly disabled, and the
configuration panel below the fold shows the deployment diagnostic. Nothing is simulated —
there is no fake session, no seeded login state, and the disabled controls have no handler.
Configure an adapter and the same URL serves the normal, fully interactive app.

### Two Vercel projects, one repo

The diagnosing field is **Vercel project ID** in the table above. Vercel keys environment
variables to a *project*, not to a repository, so if two projects build this repo (a common
result of importing it once from the dashboard and once with `vercel`), a variable added to
one is invisible to the other — and the URL you are looking at may be served by the wrong one.

One command finds the project serving a URL, configures it, deploys, and verifies:

```bash
npm run fix:vercel -- --url=https://your-app.vercel.app
```

It reads the deployment's own `/api/config` for its project ID, maps that ID to a project name
in your account, links it, uploads the adapter to every environment, deploys, then re-reads
`/api/config` and **fails if the deployed project ID is not the one it configured** — which is
how a duplicate project gets caught instead of silently ignored.

Read-only inspection instead of acting:

```bash
npm run diagnose -- --url=https://your-app.vercel.app   # reads /api/config, then inspects projects
npm run diagnose -- --url=... --search                 # also finds projects that DO have the variable
```

Or target a project you already know:

```bash
npm run deploy -- --project=<project-name> --scope=<team-slug>
```

`deploy` links that project explicitly, uploads the adapter, deploys, and finally fetches
`/api/config` to confirm the deployment's project ID matches the project it configured — so a
mismatch fails loudly instead of silently. Delete the unused duplicate project to stop the
ambiguity.
| Yellow banner above the app | Adapter loaded, but `auth-server-url` is loopback or plain `http://` and the app is served from a real host. |
| `/api/config` | Returns the adapter, or the same error text with HTTP 500, plus `warnings` when sign-in cannot work. |

The adapter is public configuration (public client settings plus the realm's public signing keys), not a credential. `KC_BOOTSTRAP_ADMIN_*`, `TIDE_LICENSE_EMAIL` and `TIDE_TERMS_ACCEPTED` are only used by `npm run init` on your own machine and do not belong in a hosted environment.

### Hosted deployments: serverless storage caveat

The synthetic store is three plain JSON files under `data/`: `bank-demo-db.json`, `face-profiles.json` and the ignored `tidecloak.json`. All three are gitignored, and Vercel's filesystem is read-only and per-instance, so a deployed instance starts with no bank database and cannot persist approvals across requests or instances. Sign-in and the landing page work when `CLIENT_ADAPTER` is set; the joint-approval flow needs a writable shared store (Postgres, KV, a mounted volume) before it can be hosted. Run the full demo locally, or wire the store before pointing a reviewer at a hosted URL.

## Verification

With the app running:

```bash
npm run typecheck
npm run build
npm run test:policy
npm run test:app-policy
npm run test:liveness
npm run test:face
npm run test:contract
npm run test:unauth
bash .tide-pack/templates/shared/tide-doctor.sh \
  --app . --url http://localhost:3000 --realm cosign-bank
```

See [TEST_RESULTS.md](./TEST_RESULTS.md) for actual results and unverified steps.

## Activate Tide-enforced withdrawal signing

The following is intentionally **not automated or claimed complete**:

1. In a fresh environment, enroll three separate co-owner Tide identities and assign `account:joint-owner` through governed Tide administration.
2. Send `security/forseti/WithdrawalApprovalContract.cs` to the Tide team at `info@tide.org` or the [official Discord](https://discord.gg/XBMd9ny2q5) for test-network review and deployment.
3. Create and commit a `PolicySignRequest` using `security/forseti/policy-manifest.json`; verify non-empty `signed_policy_data`.
4. Implement and test the documented browser `createTideRequest` / `executeSignRequest` flow against that deployed policy.
5. Replace the local application approval record with the documented Tide request/signing lifecycle and record a real two-approver ORK round.

## Security boundary

TideCloak currently protects authentication, token integrity, DPoP binding and governed role changes. The `2/2` shown in the bank UI is enforced by this Next.js backend using verified Tide subjects; it is not QEA and is not an ORK threshold signature. The proposed Forseti contract can protect signing only after Tide deploys and commits it. The host still controls the UI, API and plaintext synthetic JSON database and could change code or records. No real bank rail is connected. Downloaded information cannot be revoked.

Face recognition is implemented only as a **demo control**. Three FaceRes embeddings per user are stored as plaintext numbers in ignored local file `data/face-profiles.json`; no raw image or video is saved. The server matches fresh embeddings to the profile bound to the verified Tide subject and also checks whether another enrolled founder is a closer match. A mismatch cancels the entire synthetic request, which also means a malicious or mistaken co-owner could cause denial of service and force creation of a new request. Enrollment is trust-on-first-use: the prototype cannot prove that the correct person performed the first enrollment. The host can inspect, replace or bypass templates and code. MediaPipe movement checks can reject a static open-eye frame but are not certified against replay video or generated media. Production requires encrypted biometric storage, supervised identity proofing, passkeys, certified liveness with server-verifiable results, consent/retention controls and banking compliance review.

## Stop services

```bash
docker stop tidecloak
docker start tidecloak
```

Use [SUBMISSION_CHECKLIST.md](./SUBMISSION_CHECKLIST.md) before publishing the repository or recording the final MP4.
