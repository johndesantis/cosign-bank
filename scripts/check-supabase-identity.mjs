import assert from "node:assert/strict";
import test from "node:test";
import { resolveRoles, parseAllowlist, JOINT_OWNER_ROLE } from "../src/lib/auth/roles.ts";

// The role decision is the security-relevant part of the Supabase integration: it
// must never be influenced by anything the browser sends, only by the verified
// email and server-side configuration.

test("unset allowlist grants the joint-owner role to every authenticated account", () => {
  assert.deepEqual(resolveRoles("anyone@example.com", []), [JOINT_OWNER_ROLE]);
  assert.deepEqual(resolveRoles(undefined, []), [JOINT_OWNER_ROLE]);
});

test("allowlist grants only listed emails", () => {
  const allowlist = ["ada@example.com", "bob@bank.test"];
  assert.deepEqual(resolveRoles("ada@example.com", allowlist), [JOINT_OWNER_ROLE]);
  assert.deepEqual(resolveRoles("bob@bank.test", allowlist), [JOINT_OWNER_ROLE]);
  assert.deepEqual(resolveRoles("eve@example.com", allowlist), []);
});

test("allowlist matching is case-insensitive and tolerant of the email being absent", () => {
  const allowlist = ["ada@example.com"];
  assert.deepEqual(resolveRoles("ADA@Example.COM", allowlist), [JOINT_OWNER_ROLE]);
  assert.deepEqual(resolveRoles(undefined, allowlist), []);
  assert.deepEqual(resolveRoles("", allowlist), []);
});

test("no role is ever granted from a caller-supplied role string", () => {
  // resolveRoles only accepts an email; this guards against a future refactor that
  // starts trusting a role claim from the token.
  const allowlist = ["ada@example.com"];
  assert.deepEqual(resolveRoles("account:joint-owner", allowlist), []);
});

test("JOINT_OWNER_EMAILS parsing trims, lowercases and drops empties", () => {
  assert.deepEqual(parseAllowlist(" Ada@Example.com , ,bob@bank.test\n"), [
    "ada@example.com",
    "bob@bank.test",
  ]);
  assert.deepEqual(parseAllowlist(undefined), []);
  assert.deepEqual(parseAllowlist("   "), []);
});
