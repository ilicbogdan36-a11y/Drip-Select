// Cloudflare Worker (src/worker.js): GET /api/products
// Vraća sve proizvode (.md fajlove iz GitHub foldera) jednim pozivom, sa tokenom (bez limita od 60 poziva na sat)
// i sa kratkim kešom na ivici mreže, pa sajt ostaje brz i kad ima mnogo posetilaca.
//
// Promenljive: GITHUB_TOKEN, GH_OWNER, GH_REPO, opciono GH_BRANCH (main), GH_FOLDER (content/proizvodi)

const TTL = 30; // sekundi; posle porudžbine proizvod postaje SOLD OUT na svim uređajima za najviše toliko

const QUERY = `query($o:String!,$n:String!,$e:String!){repository(owner:$o,name:$n){object(expression:$e){... on Tree{entries{name type object{... on Blob{text isTruncated}}}}}}}`;

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.GITHUB_TOKEN || !env.GH_OWNER || !env.GH_REPO) return new Response('{"error":"config"}', { status: 500, headers: { "content-type": "application/json" } });

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(new URL(request.url).origin + "/api/products");
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }

  const branch = env.GH_BRANCH || "main", folder = env.GH_FOLDER || "content/proizvodi";
  let r;
  try {
    r = await fetch(`${env.GITHUB_API || "https://api.github.com"}/graphql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, "User-Agent": "drip-select", "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { o: env.GH_OWNER, n: env.GH_REPO, e: `${branch}:${folder}` } }),
    });
  } catch (e) { console.error("products fetch", e); return new Response('{"error":"github"}', { status: 502, headers: { "content-type": "application/json" } }); }
  if (!r.ok) { console.error("products github", r.status); return new Response('{"error":"github"}', { status: 502, headers: { "content-type": "application/json" } }); }

  const j = await r.json();
  if (j.errors) { console.error("products graphql", JSON.stringify(j.errors).slice(0, 300)); return new Response('{"error":"github"}', { status: 502, headers: { "content-type": "application/json" } }); }
  const entries = (j.data && j.data.repository && j.data.repository.object && j.data.repository.object.entries) || [];
  const items = entries
    .filter((e) => e.type === "blob" && /\.md$/i.test(e.name) && e.object && typeof e.object.text === "string" && !e.object.isTruncated)
    .map((e) => ({ file: e.name, text: e.object.text }))
    .sort((a, b) => b.file.localeCompare(a.file)); // najnoviji prvi (ime fajla počinje datumom)

  const res = new Response(JSON.stringify({ items }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${TTL}` },
  });
  if (cache && waitUntil) waitUntil(cache.put(key, res.clone()));
  return res;
}
