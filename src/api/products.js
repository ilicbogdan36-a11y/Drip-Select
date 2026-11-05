// Cloudflare Worker (src/worker.js): GET /api/products
// Vraća sve proizvode (.md fajlove iz GitHub foldera) jednim pozivom, sa tokenom (bez limita od 60 poziva na sat)
// i sa kratkim kešom na ivici mreže, pa sajt ostaje brz i kad ima mnogo posetilaca.
//
// Promenljive: GITHUB_TOKEN, GH_OWNER, GH_REPO, opciono GH_BRANCH (main), GH_FOLDER (content/proizvodi)

const TTL = 10; // sekundi keša na ivici mreže; porudžbina ga briše odmah, a izmena u adminu se vidi za najviše toliko
const JSON_H = { "content-type": "application/json; charset=utf-8" };

const QUERY = `query($o:String!,$n:String!,$e:String!){repository(owner:$o,name:$n){object(expression:$e){... on Tree{entries{name type object{... on Blob{text isTruncated}}}}}}}`;

// Učitava listu proizvoda (JSON tekst {"items":[...]}) iz keša ili sa GitHub-a. Koristi je i /api/products i stranica /proizvod/<ime>.
// Vraća { body } ili { err, status }.
export async function loadBody(env, origin, waitUntil) {
  return loadFolder(env, origin, waitUntil, env.GH_FOLDER || "content/proizvodi", "/api/products");
}

// Isto za bilo koji folder (npr. utisci kupaca): ključ keša je zasebna putanja
export async function loadFolder(env, origin, waitUntil, folder, cachePath) {
  if (!env.GITHUB_TOKEN || !env.GH_OWNER || !env.GH_REPO) return { err: "config", status: 500 };

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(origin + cachePath);
  if (cache) { const hit = await cache.match(key); if (hit) return { body: await hit.text() }; }

  const branch = env.GH_BRANCH || "main";
  let r;
  try {
    r = await fetch(`${env.GITHUB_API || "https://api.github.com"}/graphql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, "User-Agent": "drip-select", "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { o: env.GH_OWNER, n: env.GH_REPO, e: `${branch}:${folder}` } }),
    });
  } catch (e) { console.error("products fetch", e); return { err: "github", status: 502 }; }
  if (!r.ok) { console.error("products github", r.status); return { err: "github", status: 502 }; }

  const j = await r.json();
  if (j.errors) { console.error("products graphql", JSON.stringify(j.errors).slice(0, 300)); return { err: "github", status: 502 }; }
  const entries = (j.data && j.data.repository && j.data.repository.object && j.data.repository.object.entries) || [];
  const items = entries
    .filter((e) => e.type === "blob" && /\.md$/i.test(e.name) && e.object && typeof e.object.text === "string" && !e.object.isTruncated)
    .map((e) => ({ file: e.name, text: e.object.text }))
    .sort((a, b) => b.file.localeCompare(a.file)); // najnoviji prvi (ime fajla počinje datumom)

  const body = JSON.stringify({ items });
  if (cache && waitUntil) waitUntil(cache.put(key, new Response(body, { headers: { ...JSON_H, "cache-control": `public, max-age=${TTL}` } })));
  return { body };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const r = await loadBody(env, new URL(request.url).origin, waitUntil);
  if (r.err) return new Response(JSON.stringify({ error: r.err }), { status: r.status, headers: { "content-type": "application/json" } });
  return new Response(r.body, { headers: { ...JSON_H, "cache-control": "no-store" } }); // pregledač ne sme da drži staru listu
}
