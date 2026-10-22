import { authMode } from "@/lib/auth/authMode";
import { getSupabaseConfig, supabaseConfigProblem } from "@/lib/auth/supabaseIdentity";

export const dynamic = "force-dynamic";

// Public authentication settings for the browser.
//
// The Supabase URL and anon/public key are public by design: the anon key is the
// browser key, and row-level security governs data access. Serving them from a route
// means the browser does not depend on `NEXT_PUBLIC_*` being inlined at build time,
// so storing the variables in Vercel under SUPABASE_URL / SUPABASE_ANON_KEY works
// just as well as the NEXT_PUBLIC_* names.
//
// The service-role key is never returned: resolveSupabaseEnv refuses it outright.
export async function GET() {
  const mode = authMode();
  const config = getSupabaseConfig();

  if (mode !== "supabase" || !config) {
    const problem = supabaseConfigProblem();
    return Response.json(
      {
        authMode: mode,
        supabase: null,
        ...(problem ? { problem: { code: problem.code, message: problem.message } } : {}),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    {
      authMode: "supabase",
      supabase: {
        url: config.url,
        anonKey: config.anonKey,
        urlSource: config.urlSource,
        keySource: config.keySource,
      },
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
