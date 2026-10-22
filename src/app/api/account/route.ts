import { withRole } from "@/lib/auth/protect";
import { authMode } from "@/lib/auth/authMode";
import { displayNameFromToken } from "@/lib/auth/identity";
import { bankStorageMode, readBankDatabase } from "@/lib/demo-db";
import { getFaceProfileStatus } from "@/lib/face-profile-store";

export const dynamic = "force-dynamic";

export const GET = withRole("account:joint-owner", async (_request, jwt) => {
  const mode = authMode();
  if (!jwt.sub) {
    return Response.json({ error: "Verified Tide token has no subject" }, { status: 400 });
  }
  const database = await readBankDatabase();
  const faceProfile = await getFaceProfileStatus(jwt.sub);
  const withdrawalRequests = database.withdrawalRequests.map(
    ({ requestedBySubject, approvals, ...withdrawal }) => ({
      ...withdrawal,
      approvals: approvals.map(({ subject, ...approval }) => ({
        ...approval,
        isCurrentUser: subject === jwt.sub,
      })),
      viewer: {
        isRequester: requestedBySubject === jwt.sub,
        hasApproved: approvals.some((approval) => approval.subject === jwt.sub),
      },
    }),
  );
  return Response.json(
    {
      account: database.account,
      recentActivity: database.recentActivity,
      withdrawalRequests,
      session: {
        verifiedSubject: jwt.sub,
        displayName: displayNameFromToken(jwt),
      },
      faceProfile,
      security: {
        authMode: mode,
        syntheticStore: bankStorageMode(),
        tideLogin:
          mode === "tidecloak"
            ? "tidecloak-verified-server-side"
            : mode === "supabase"
              ? "supabase-email-password-verified-server-side"
              : "simulated-not-tidecloak",
        dpop:
          mode === "tidecloak" ? "strict" : "not-applicable-" + mode,
        tokenVerification:
          mode === "supabase" ? "verified-with-supabase-auth-server" : mode,
        applicationApproval: "server-enforced-demo",
        signingPolicy: "requires-tide-team-deployment",
        biometricLiveness: "client-camera-challenge",
        faceIdentity: faceProfile.enrolled ? "server-matched-embedding-demo" : "enrollment-required",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
