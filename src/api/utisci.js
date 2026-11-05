// Cloudflare Worker (src/worker.js): GET /api/utisci
// Utisci kupaca (.md fajlovi iz foldera content/utisci, unose se u adminu). Isti mehanizam i keš kao /api/products.
// Dok folder ne postoji ili je prazan, vraća praznu listu, pa sajt jednostavno ne prikazuje sekciju.
import { loadFolder } from "./products.js";

const JSON_H = { "content-type": "application/json; charset=utf-8" };

export async function onRequestGet({ request, env, waitUntil }) {
  const r = await loadFolder(env, new URL(request.url).origin, waitUntil, env.GH_REVIEWS_FOLDER || "content/utisci", "/api/utisci");
  if (r.err) return new Response(JSON.stringify({ error: r.err }), { status: r.status, headers: { "content-type": "application/json" } });
  // neobjavljeni utisci (objavi: false) ne napuštaju server
  let body = r.body;
  try {
    const o = JSON.parse(body);
    o.items = (o.items || []).filter((it) => !/^objavi:\s*["']?(false|ne|no|0)["']?\s*$/im.test(String(it.text).split(/^---\s*$/m)[1] || ""));
    body = JSON.stringify(o);
  } catch (e) { return new Response(JSON.stringify({ error: "parse" }), { status: 502, headers: { "content-type": "application/json" } }); }
  return new Response(body, { headers: { ...JSON_H, "cache-control": "no-store" } });
}
