// Slike proizvoda koje je admin upravo otpremio, a sajt još nije ponovo objavljen.
// Proizvod se u listi pojavi za desetak sekundi, ali nova slika iz public/images/products/ stigne na sajt tek kad se završi objava
// (nekoliko minuta). Do tada Cloudflare ne nalazi taj fajl i zahtev stiže ovamo: slika se uzima direktno sa GitHub-a.
// Čim objava stigne, fajl servira Cloudflare iz public/ (ova funkcija se tada više ne poziva).
//
// Zaštita: servira se samo fajl koji neki proizvod trenutno koristi (provera na kešovanoj listi, bez poziva GitHub-a),
// pa se slučajnim adresama ne mogu trošiti pozivi ka GitHub-u. Dozvoljene su samo slike, bez podfoldera.
import { loadBody } from "./api/products.js";

const PREFIX = "/images/products/";
const NAME_RE = /^[\w][\w.\- ()]{0,150}\.(webp|jpe?g|png|gif|avif)$/i;
const TYPES = { webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", avif: "image/avif" };
const TTL = 300; // sekundi keša (pregledač i ivica mreže)

const notFound = () => new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=10" } });

export async function productImage({ request, env, waitUntil }) {
  const url = new URL(request.url);
  let name;
  try { name = decodeURIComponent(url.pathname.slice(PREFIX.length)); } catch (e) { return notFound(); }
  if (!NAME_RE.test(name)) return notFound();
  if (!env.GITHUB_TOKEN || !env.GH_OWNER || !env.GH_REPO) return notFound();

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const ckey = new Request(url.origin + PREFIX + encodeURIComponent(name));
  if (cache) { const hit = await cache.match(ckey); if (hit) return request.method === "HEAD" ? new Response(null, { status: 200, headers: hit.headers }) : hit; }

  // samo slike koje proizvod stvarno koristi
  const list = await loadBody(env, url.origin, waitUntil);
  if (list.err) return notFound();
  let items;
  try { items = JSON.parse(list.body).items || []; } catch (e) { return notFound(); }
  const used = items.some((it) => typeof it.text === "string" && (it.text.includes(PREFIX + name) || it.text.includes(PREFIX + encodeURIComponent(name))));
  if (!used) return notFound();

  const branch = env.GH_BRANCH || "main";
  let r;
  try {
    r = await fetch(`${env.GITHUB_API || "https://api.github.com"}/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/public/images/products/${encodeURIComponent(name)}?ref=${encodeURIComponent(branch)}`, {
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github.raw+json", "User-Agent": "drip-select" },
    });
  } catch (e) { console.error("image fetch", e); return notFound(); }
  if (!r.ok) { if (r.status !== 404) console.error("image github", r.status); return notFound(); }

  const buf = await r.arrayBuffer();
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const headers = { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": `public, max-age=${TTL}`, "x-content-type-options": "nosniff" };
  if (cache && waitUntil) waitUntil(cache.put(ckey, new Response(buf, { headers })));
  return new Response(request.method === "HEAD" ? null : buf, { headers });
}
