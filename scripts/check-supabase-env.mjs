import assert from "node:assert/strict";
import test from "node:test";
import {
  looksLikeServiceRoleKey,
  resolveSupabaseEnv,
  supabaseEnvReport,
} from "../src/lib/auth/supabaseEnv.ts";

// These cases exist because of a real deployment hazard: the same project's
// variables are named differently in different dashboards, and a service-role key
// pasted into a public variable would hand every browser full database access.

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const anonJwt = `header.${b64({ role: "anon" })}.sig`;
const serviceJwt = `header.${b64({ role: "service_role" })}.sig`;

test("accepts the NEXT_PUBLIC_* names from Supabase's dashboard snippet", () => {
  const resolved = resolveSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonJwt,
  });
  assert.equal(resolved.problem, null);
  assert.equal(resolved.config.url, "https://abc.supabase.co");
  assert.equal(resolved.config.keySource, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
});

test("accepts server-style names, which NEXT_PUBLIC_* inlining would have broken", () => {
  const resolved = resolveSupabaseEnv({
    SUPABASE_URL: "https://abc.supabase.co/",
    SUPABASE_ANON_KEY: anonJwt,
  });
  assert.equal(resolved.problem, null);
  assert.equal(resolved.config.urlSource, "SUPABASE_URL");
  assert.equal(resolved.config.keySource, "SUPABASE_ANON_KEY");
  // Trailing slash trimmed
  assert.equal(resolved.config.url, "https://abc.supabase.co");
});

test("accepts new-style publishable keys", () => {
  const resolved = resolveSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_123",
  });
  assert.equal(resolved.problem, null);
  assert.equal(resolved.config.keySource, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
});

test("returns null when nothing at all is configured", () => {
  assert.equal(resolveSupabaseEnv({}), null);
  assert.equal(resolveSupabaseEnv({ UNRELATED: "x" }), null);
});

test("explains a half-configured project instead of silently ignoring it", () => {
  const noUrl = resolveSupabaseEnv({ SUPABASE_ANON_KEY: anonJwt });
  assert.equal(noUrl.config, null);
  assert.equal(noUrl.problem.code, "missing-url");

  const noKey = resolveSupabaseEnv({ SUPABASE_URL: "https://abc.supabase.co" });
  assert.equal(noKey.config, null);
  assert.equal(noKey.problem.code, "missing-key");

  const badUrl = resolveSupabaseEnv({ SUPABASE_URL: "abc.supabase.co", SUPABASE_ANON_KEY: anonJwt });
  assert.equal(badUrl.problem.code, "bad-url");
});

test("refuses a service-role key in any public variable", () => {
  const jwt = resolveSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: serviceJwt,
  });
  assert.equal(jwt.config, null);
  assert.equal(jwt.problem.code, "service-role-key");
  assert.match(jwt.problem.message, /never be used/);

  const opaque = resolveSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    SUPABASE_KEY: "sb_secret_abc",
  });
  assert.equal(opaque.problem.code, "service-role-key");

  const named = resolveSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    SUPABASE_ANON_KEY: "anything_service_role_anything",
  });
  assert.equal(named.problem.code, "service-role-key");
});

test("service-role detection does not flag an anon key", () => {
  assert.equal(looksLikeServiceRoleKey(anonJwt), false);
  assert.equal(looksLikeServiceRoleKey(serviceJwt), true);
  assert.equal(looksLikeServiceRoleKey("not-a-jwt"), false);
});

test("env report lists presence only, never values", () => {
  const report = supabaseEnvReport({
    SUPABASE_URL: "https://secret-looking-url.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonJwt,
  });
  const serialised = JSON.stringify(report);
  assert.equal(serialised.includes("supabase.co"), false);
  assert.equal(serialised.includes(anonJwt), false);
  assert.equal(report.urlKeys.find((entry) => entry.key === "SUPABASE_URL").present, true);
  assert.equal(
    report.urlKeys.find((entry) => entry.key === "NEXT_PUBLIC_SUPABASE_URL").present,
    false,
  );
  assert.equal(
    report.keyKeys.find((entry) => entry.key === "NEXT_PUBLIC_SUPABASE_ANON_KEY").present,
    true,
  );
});
