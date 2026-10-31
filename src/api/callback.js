// Cloudflare Worker (src/worker.js): GET /api/callback
// GitHub vraća korisnika ovde posle prijave. Menjamo kod za token i predajemo ga Decap-u (prozor /admin).
//
// Promenljive: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET (secret), opciono ALLOWED_USERS (GitHub korisnička imena, zarezom)

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function page(payload) {
  const ok = !!payload.token;
  const msg = ok
    ? "authorization:github:success:" + JSON.stringify({ token: payload.token, provider: "github" })
    : "authorization:github:error:" + JSON.stringify({ message: payload.error });
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prijava</title>
<body style="font-family:system-ui,sans-serif;background:#0b0e14;color:#fff;padding:28px"><p>${ok ? "Prijava uspešna, zatvaram prozor..." : esc(payload.error)}</p>
<script>
(function(){
  var msg=${JSON.stringify(msg).replace(/</g, "\\u003c")};
  function receive(e){
    if(e.origin!==location.origin)return;
    window.opener.postMessage(msg,e.origin);
    window.removeEventListener("message",receive,false);
  }
  window.addEventListener("message",receive,false);
  if(window.opener)window.opener.postMessage("authorizing:github",location.origin);
})();
</script>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "Set-Cookie": "ds_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=0",
    },
  });
}

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return page({ error: "Nedostaju GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET u podešavanjima Cloudflare-a." });
  const url = new URL(request.url);
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  const c = (request.headers.get("cookie") || "").split(/;\s*/).find((x) => x.startsWith("ds_oauth_state="));
  const expected = c ? c.slice("ds_oauth_state=".length) : "";
  if (!code || !state || !expected || state !== expected) return page({ error: "Neispravan zahtev za prijavu. Zatvori ovaj prozor i pokušaj ponovo." });

  let j;
  try {
    const r = await fetch(`${env.GITHUB_OAUTH_BASE || "https://github.com"}/login/oauth/access_token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "drip-select" },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${url.origin}/api/callback` }),
    });
    j = await r.json();
  } catch (e) { console.error("oauth token", e); return page({ error: "GitHub trenutno ne odgovara. Pokušaj ponovo." }); }
  if (!j || !j.access_token) return page({ error: (j && (j.error_description || j.error)) || "GitHub nije vratio token." });

  if (env.ALLOWED_USERS) {
    try {
      const u = await (await fetch(`${env.GITHUB_API || "https://api.github.com"}/user`, {
        headers: { Authorization: `Bearer ${j.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "drip-select" },
      })).json();
      const allowed = String(env.ALLOWED_USERS).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (!allowed.includes(String(u.login || "").toLowerCase())) return page({ error: `Nalog ${u.login || ""} nema pristup admin panelu.` });
    } catch (e) { console.error("oauth user", e); return page({ error: "Ne mogu da proverim nalog. Pokušaj ponovo." }); }
  }
  return page({ token: j.access_token });
}
