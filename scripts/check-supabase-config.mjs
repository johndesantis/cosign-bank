#!/usr/bin/env node
// check:supabase — validate Supabase configuration before deploying.
//
//   npm run check:supabase
//
// Checks:
//   1. NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are present/shaped
//   2. the anon key is not a service-role key (never ship that to a browser)
//   3. /auth/v1/health answers with the anon key
//   4. email/password is enabled (the settings endpoint reports the providers)
//
// Exit 0 = usable, 1 = blocking problem, 2 = warnings only.

import { readFileSync } from "node:fs";
import path from "node:path";
import { colors as c } from "./lib/adapter.mjs";

// Allow validating from a local .env without exporting everything by hand.
function loadEnvFile() {
  for (const file of [".env.local", ".env"]) {
    try {
      const raw = readFileSync(path.join(process.cwd(), file), "utf8");
      for (const line of raw.split("\n")) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (process.env[key] !== undefined) continue;
        process.env[key] = rawValue.replace(/^["']|["']$/g, "");
      }
      return file;
    } catch {
      // try next
    }
  }
  return null;
}

const loaded = loadEnvFile();
if (loaded) console.log(`${c.dim("Loaded")} ${loaded}`);

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
const key = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  ""
).trim();

const problems = [];
const warnings = [];

if (!url) {
  problems.push("NEXT_PUBLIC_SUPABASE_URL is not set (https://<project-ref>.supabase.co)");
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) {
  warnings.push(`NEXT_PUBLIC_SUPABASE_URL looks unusual: ${url}`);
}

if (!key) {
  problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
} else {
  // Decode the JWT payload to spot a service-role key before it ships to a browser.
  try {
    const payload = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64").toString("utf8"));
    if (payload.role === "service_role") {
      problems.push(
        "That is a SERVICE ROLE key. It bypasses row-level security and must never be " +
          "exposed to the browser — use the anon/public key instead.",
      );
    } else if (payload.role && payload.role !== "anon") {
      warnings.push(`Key role is "${payload.role}", expected "anon"`);
    }
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      warnings.push("The anon key appears to be expired");
    }
  } catch {
    warnings.push("Could not decode the anon key (new-format keys are opaque; fine)");
  }
}

if (problems.length === 0) {
  const base = url.replace(/\/+$/, "");
  try {
    const health = await fetch(`${base}/auth/v1/health`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!health.ok) {
      problems.push(`/auth/v1/health returned HTTP ${health.status}`);
    } else {
      console.log(`${c.green("✓")} Supabase auth endpoint reachable (${base})`);
    }
  } catch (error) {
    problems.push(
      `Could not reach ${base}/auth/v1/health (${
        error instanceof Error ? error.message : error
      }). Check the project URL and outbound DNS.`,
    );
  }
}

// Provider list: confirms the email provider (username/password) is enabled.
if (problems.length === 0) {
  try {
    const base = url.replace(/\/+$/, "");
    const settings = await fetch(`${base}/auth/v1/settings`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(8000),
    });
    if (settings.ok) {
      const body = await settings.json();
      const external = body?.external ?? {};
      if (body?.disable_signup) {
        warnings.push(
          "Sign-ups are disabled on this Supabase project (Auth → Providers → Email → " +
            "'Allow new users to sign up'). Registration will fail.",
        );
      }
      if (external.email === false) {
        problems.push("The email provider is disabled on this Supabase project.");
      } else {
        console.log(`${c.green("✓")} Email provider enabled`);
      }
      if (external.confirmations !== false) {
        console.log(
          `${c.dim("note:")} email confirmations are on, so new users must click the link ` +
            "before signing in (the app tells them).",
        );
      }
    }
  } catch {
    warnings.push("Could not read /auth/v1/settings; provider state unknown");
  }
}

const allowlist = (process.env.JOINT_OWNER_EMAILS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

console.log("");
if (allowlist.length > 0) {
  console.log(`${c.green("✓")} Role grant: allowlist of ${allowlist.length} email(s)`);
} else {
  console.log(
    `${c.yellow("!")} Role grant: JOINT_OWNER_EMAILS is unset, so EVERY authenticated ` +
      "account receives account:joint-owner (demo-open).",
  );
}

for (const warning of warnings) console.log(`${c.yellow("!")} ${warning}`);

if (problems.length > 0) {
  console.error("");
  for (const problem of problems) console.error(`${c.red("✗")} ${problem}`);
  console.error("");
  console.error(c.red("NOT READY") + " — fix the items above, then redeploy.");
  process.exit(1);
}

console.log("");
console.log(`${c.green("READY")} — Supabase email/password sign-in is configured.`);
console.log(c.dim("Set the same variables in Vercel (Production + Preview), then redeploy."));
process.exit(warnings.length > 0 ? 2 : 0);
