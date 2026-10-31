// Cloudflare Worker (src/worker.js): GET /api/auth
// Početak prijave u /admin (Decap CMS) preko GitHub naloga. Decap otvara ovu adresu u malom prozoru.
//
// Promenljive: GITHUB_CLIENT_ID (iz GitHub OAuth aplikacije), opciono OAUTH_SCOPE (public_repo; za privatan repo stavi repo)

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_CLIENT_ID) return new Response("Nedostaje GITHUB_CLIENT_ID u podešavanjima Cloudflare-a.", { status: 500 });
  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const to = new URL(`${env.GITHUB_OAUTH_BASE || "https://github.com"}/login/oauth/authorize`);
  to.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  to.searchParams.set("redirect_uri", `${url.origin}/api/callback`);
  to.searchParams.set("scope", env.OAUTH_SCOPE || "public_repo");
  to.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: to.toString(),
      "Set-Cookie": `ds_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=600`,
      "Cache-Control": "no-store",
    },
  });
}
