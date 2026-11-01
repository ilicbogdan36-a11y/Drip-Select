// Cloudflare Worker (src/worker.js):
//   GET /proizvod/<ime>  -> isti sajt (index.html), ali sa naslovom, opisom i slikom TOG proizvoda u zaglavlju stranice,
//                           pa pregled linka (Viber, WhatsApp, Facebook, Telegram, Discord...) pokazuje taj proizvod.
//   GET /og-img/<ime>    -> slika za pregled: mora da bude mala (WhatsApp/Viber odbacuju slike preko ~300 KB).
//                           Pokuša se smanjivanje preko Cloudflare Image Transformations; ako nije uključeno,
//                           a original je mali, šalje se original; inače logo sajta (pregled nikad ne ostane bez slike).
import { loadBody } from "./api/products.js";

const MAX_IMG = 290 * 1024; // iznad ovoga neke mreže ne prikazuju sliku
const OK_TYPES = /^image\/(jpeg|png|webp)/i;
const HTML_H = { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" };

// ---- isto čitanje proizvoda kao na sajtu (public/index.html): fm(), mkSlug(), polja
function fm(text) {
  const m = String(text).replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const d = { body: "" };
  if (!m) return d;
  let last = null;
  m[1].split(/\r?\n/).forEach((l) => {
    const k = l.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (k) {
      let v = k[2].trim();
      if (/^[>|][+-]?$/.test(v)) v = "";
      else if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"');
      else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
      d[(last = k[1])] = v;
    } else if (last && /^\s+\S/.test(l)) d[last] = (d[last] + " " + l.trim()).trim();
  });
  d.body = m[2].trim();
  return d;
}
function mkSlug(file, used) {
  let s = String(file || "").replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}-/, "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "dj").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s) s = "proizvod";
  const b = s;
  let n = 2;
  while (used[s]) s = b + "-" + n++;
  used[s] = 1;
  return s;
}
export function parseProducts(items) {
  const used = {};
  const out = [];
  for (const it of items || []) {
    const d = fm(it.text);
    if (!d.title) continue; // kao na sajtu: bez naslova nema proizvoda (ni slug-a)
    const photos = [d.image, d.image2, d.image3, d.image4, d.image5].filter(Boolean).map((x) => (/^(https?:)?\/\//.test(x) || x[0] === "/" ? x : "/" + x));
    out.push({
      slug: mkSlug(it.file, used),
      name: d.title,
      brand: d.brand || "",
      size: d.size || "",
      color: d.color || "",
      price: parseFloat(d.price) || 0,
      photo: photos[0] || "",
      focus: String(d.focus || "").trim().toLowerCase(),
      sold: /^(true|da|yes|1)$/i.test(d.sold || ""),
    });
  }
  return out;
}

// "Kadar slike" iz admina (isto kao na sajtu: gore, dole...) -> tačka oko koje se seče slika za pregled; bez izbora: Cloudflare sam nađe glavni deo slike
const FOCUS = { sredina: [0.5, 0.5], "gore-malo": [0.5, 0.75], gore: [0.5, 1], "dole-malo": [0.5, 0.25], dole: [0.5, 0], levo: [1, 0.5], desno: [0, 0.5] };
const gravity = (f) => (FOCUS[f] ? { x: FOCUS[f][0], y: FOCUS[f][1] } : "auto");
const OG_VER = "2"; // povećaj kad se izgled slike za pregled promeni, da mreže ne drže staru
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtPrice = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " din.";
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

function setMeta(head, attr, name, content) {
  const re = new RegExp('(<meta\\s+' + attr + '="' + name + '"\\s+content=")[^"]*(")');
  return head.replace(re, (m, a, b) => a + esc(content) + b);
}

export function describe(p) {
  if (p.sold) return "Ovaj proizvod je već prodat.";
  const facts = [p.brand, p.size ? "Vel. " + p.size : "", p.color].filter(Boolean).join(" · ");
  return (facts ? facts + " – " : "") + fmtPrice(p.price);
}

export function injectProduct(html, p, origin) {
  const i = html.indexOf("</head>");
  if (i < 0) return html;
  let head = html.slice(0, i);
  const url = origin + "/proizvod/" + p.slug;
  const title = p.name + " – Drip Select";
  const desc = describe(p);
  const img = origin + "/og-img/" + p.slug + "?v=" + hash((p.photo || "-") + "|" + p.focus + "|" + OG_VER);
  head = head.replace(/<title>[\s\S]*?<\/title>/, () => "<title>" + esc(title) + "</title>"); // funkcija: $& i slično u nazivu se ne tumače
  head = setMeta(head, "name", "description", desc);
  head = setMeta(head, "property", "og:title", title);
  head = setMeta(head, "property", "og:description", desc);
  head = setMeta(head, "property", "og:url", url);
  head = setMeta(head, "property", "og:image", img);
  head = setMeta(head, "property", "og:image:alt", p.name);
  head = setMeta(head, "name", "twitter:title", title);
  head = setMeta(head, "name", "twitter:description", desc);
  head = setMeta(head, "name", "twitter:image", img);
  // dimenzije i tip važe za logo, a ne za sliku proizvoda
  head = head.replace(/<meta\s+property="og:image:(type|width|height)"[^>]*>\s*/g, "");
  head += '<link rel="canonical" href="' + esc(url) + '">\n';
  return head + html.slice(i);
}

const slugOf = (url, prefix) => {
  let s = url.pathname.slice(prefix.length).replace(/\/+$/, "");
  try { s = decodeURIComponent(s); } catch (e) { /* ostaje kako je */ }
  return s;
};

async function findProduct(env, origin, waitUntil, slug) {
  const r = await loadBody(env, origin, waitUntil);
  if (r.err) return { failed: true };
  let items = [];
  try { items = JSON.parse(r.body).items; } catch (e) { return { failed: true }; }
  return { product: parseProducts(items).find((p) => p.slug === slug) || null };
}

export async function productPage({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const [idx, found] = await Promise.all([
    env.ASSETS.fetch(new Request(url.origin + "/")),
    findProduct(env, url.origin, waitUntil, slugOf(url, "/proizvod/")),
  ]);
  if (!idx.ok) return idx;
  let html = await idx.text();
  let status = 200;
  if (found.failed) { /* GitHub ne radi: sajt sam učita proizvode, samo je pregled opšti */ }
  else if (!found.product) status = 404; // nepoznat proizvod: sajt prikaže početnu
  else html = injectProduct(html, found.product, url.origin);
  return new Response(request.method === "HEAD" ? null : html, { status, headers: HTML_H });
}

async function logo(env, origin) {
  const r = await env.ASSETS.fetch(new Request(origin + "/og.jpg"));
  return new Response(r.body, { status: r.status, headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=300" } });
}

export async function ogImage({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const ckey = new Request(url.origin + url.pathname + url.search);
  if (cache) { const hit = await cache.match(ckey); if (hit) return hit; }

  const found = await findProduct(env, url.origin, waitUntil, slugOf(url, "/og-img/"));
  if (!found.product || !found.product.photo) return logo(env, url.origin);
  const src = /^https?:/.test(found.product.photo) ? found.product.photo : url.origin + found.product.photo;
  const done = (buf, type) => {
    const res = new Response(buf, { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
    if (cache && waitUntil) waitUntil(cache.put(ckey, res.clone()));
    return res;
  };

  // 1) smanjena verzija 1200x630 preko cele slike (bez traka); radi samo ako su Image Transformations uključene
  try {
    const t = await fetch(src, { cf: { image: { width: 1200, height: 630, fit: "cover", gravity: gravity(found.product.focus), quality: 80, format: "jpeg" } } });
    const ty = t.headers.get("content-type") || "";
    if (t.ok && /^image\/jpeg/i.test(ty)) {
      const buf = await t.arrayBuffer();
      if (buf.byteLength <= MAX_IMG) return done(buf, "image/jpeg");
    }
  } catch (e) { /* nije dostupno: probamo original */ }

  // 2) original, ako je dovoljno mali
  try {
    const o = src.startsWith(url.origin) ? await env.ASSETS.fetch(new Request(src)) : await fetch(src); // slike sajta iz public/, tuđe adrese običnim fetch-om
    const ty = o.headers.get("content-type") || "";
    if (o.ok && OK_TYPES.test(ty)) {
      const buf = await o.arrayBuffer();
      if (buf.byteLength <= MAX_IMG) return done(buf, ty.split(";")[0]);
    }
  } catch (e) { /* idemo na logo */ }

  // 3) logo
  return logo(env, url.origin);
}
