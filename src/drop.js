// Obaveštenja o novom dropu.
//  - Pretplatnici (ko upiše mejl na "Novi drop uskoro") žive u Resend-u: kontakti u segmentu "Drop pretplatnici".
//  - Worker na svakih ~10 min (Cron Trigger u wrangler.jsonc) pogleda ima li novih proizvoda na stanju. Kad se lista
//    proizvoda ne menja bar ~15 min (da ceo drop ode u jednom mejlu), pošalje Resend Broadcast svima u segmentu.
//  - Šta je već javljeno pamti se u state/drop.json u repou (samo imena fajlova proizvoda, ništa lično).
//    Prvi put se svi postojeći proizvodi samo upišu kao "javljeno", bez slanja.
import { loadBody } from "./api/products.js";
import { parseProducts } from "./page.js";

const SEG_NAME = "Drop pretplatnici";
const STATE_PATH = "state/drop.json";
const MAX_WAIT_MS = 2 * 3600 * 1000; // ako se lista stalno menja, ipak pošalji najkasnije posle 2 sata
const MAX_SHOWN = 6;

const site = (env) => String(env.SITE_URL || "https://dripselect.rs").replace(/\/+$/, "");
const apiBase = (env) => String(env.RESEND_BASE || "https://api.resend.com").replace(/\/+$/, "");
const apiKey = (env) => env.RESEND_MARKETING_KEY || env.RESEND_API_KEY;
const settleMs = (env) => (+env.DROP_SETTLE_MIN > 0 ? +env.DROP_SETTLE_MIN : 15) * 60000;

async function rs(env, method, path, body) {
  const r = await fetch(apiBase(env) + path, {
    method,
    headers: { Authorization: `Bearer ${apiKey(env)}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null;
  try { j = await r.json(); } catch (e) { /* prazan odgovor */ }
  return { ok: r.ok, status: r.status, json: j };
}
const fail = (what, r) => Object.assign(new Error(`${what}: resend ${r.status} ${JSON.stringify(r.json || {}).slice(0, 200)}`), { status: r.status });

// ---------- pretplatnici ----------
const oldest = (list) => list.filter((s) => s.name === SEG_NAME).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
export async function ensureSegment(env) {
  if (env.RESEND_SEGMENT_ID) return env.RESEND_SEGMENT_ID;
  let r = await rs(env, "GET", "/segments");
  if (!r.ok) throw fail("segments", r);
  const hit = oldest((r.json && r.json.data) || []);
  if (hit) return hit.id;
  r = await rs(env, "POST", "/segments", { name: SEG_NAME });
  if (!r.ok) throw fail("segment create", r);
  // ako su dvoje istovremeno napravili segment, svi koriste najstariji
  const again = await rs(env, "GET", "/segments");
  return (again.ok && oldest((again.json && again.json.data) || []))?.id || r.json.id;
}
export async function addSubscriber(env, email) {
  if (!apiKey(env)) return { skipped: true };
  const seg = await ensureSegment(env);
  const r = await rs(env, "POST", "/contacts", { email, unsubscribed: false, segments: [{ id: seg }] });
  if (r.ok) return { ok: true };
  // verovatno već postoji: samo ga dodaj u segment (odjavljeni ostaju odjavljeni)
  const a = await rs(env, "POST", `/contacts/${encodeURIComponent(email)}/segments/${seg}`);
  if (a.ok) return { ok: true, existed: true };
  throw fail("contact", r);
}

// ---------- stanje u repou ----------
const b64d = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
const b64e = (t) => { let s = ""; for (const b of new TextEncoder().encode(t)) s += String.fromCharCode(b); return btoa(s); };
function gh(env) {
  if (!env.GITHUB_TOKEN || !env.GH_OWNER || !env.GH_REPO) return null;
  return {
    url: `${env.GITHUB_API || "https://api.github.com"}/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${STATE_PATH}`,
    branch: env.GH_BRANCH || "main",
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "drip-select", "Content-Type": "application/json" },
  };
}
async function readState(g) {
  const r = await fetch(`${g.url}?ref=${encodeURIComponent(g.branch)}`, { headers: g.headers });
  if (r.status === 404) return { missing: true };
  if (!r.ok) throw new Error("state read " + r.status);
  const j = await r.json();
  let s = {};
  try { s = JSON.parse(b64d(j.content || "")); } catch (e) { s = {}; }
  return { sha: j.sha, s };
}
// vraća novi sha; baca grešku ako upis nije prošao (npr. neko drugi je upisao: sha se ne poklapa)
async function writeState(g, sha, s, msg) {
  const body = { message: msg + " [skip ci]", content: b64e(JSON.stringify(s, null, 1) + "\n"), branch: g.branch };
  if (sha) body.sha = sha;
  const r = await fetch(g.url, { method: "PUT", headers: g.headers, body: JSON.stringify(body) });
  if (!r.ok) throw Object.assign(new Error("state write " + r.status), { status: r.status });
  return (await r.json()).content.sha;
}

// ---------- mejl ----------
const esc = (s) => String(s).replace(/[&<>"'{}]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "{": "&#123;", "}": "&#125;" }[c]));
const fmtPrice = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " din.";
const facts = (p) => [p.brand, p.size ? "Vel. " + p.size : "", p.color].filter(Boolean).join(" · ");

export function buildDrop(items, env) {
  const S = site(env), shown = items.slice(0, MAX_SHOWN), more = items.length - shown.length;
  const subject = items.length === 1 ? `Novi drop: ${items[0].name}` : "Novi drop je stigao";
  const card = (p) => {
    const url = `${S}/proizvod/${encodeURIComponent(p.slug)}`;
    const img = p.photo ? `<a href="${url}"><img src="${S}/og-img/${encodeURIComponent(p.slug)}" alt="${esc(p.name)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:12px"></a>` : "";
    return `<tr><td style="padding:0 0 28px">${img}<div style="padding-top:12px;font:600 18px Arial,sans-serif;color:#f4f6fa">${esc(p.name)}</div>` +
      (facts(p) ? `<div style="padding-top:4px;font:14px Arial,sans-serif;color:#8b93a7">${esc(facts(p))}</div>` : "") +
      `<div style="padding-top:6px;font:700 17px Arial,sans-serif;color:#6fb1ff">${esc(fmtPrice(p.price))}</div>` +
      `<div style="padding-top:12px"><a href="${url}" style="display:inline-block;background:#1a8cff;color:#fff;text-decoration:none;font:700 14px Arial,sans-serif;padding:11px 22px;border-radius:10px">Pogledaj proizvod</a></div></td></tr>`;
  };
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#07080c" bgcolor="#07080c">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">Pogledaj šta je novo na Drip Select-u.</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#07080c"><tr><td align="center" style="padding:28px 14px">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px" bgcolor="#0f121a"><tr><td style="padding:28px 20px 6px">` +
    `<div style="font:700 13px Arial,sans-serif;letter-spacing:3px;color:#6fb1ff">DRIP SELECT</div>` +
    `<h1 style="margin:10px 0 6px;font:700 26px Arial,sans-serif;color:#f4f6fa">Novi drop je stigao</h1>` +
    `<p style="margin:0 0 24px;font:15px Arial,sans-serif;color:#8b93a7">Upisao/la si mejl da ti javimo kad izađe nešto novo. Evo šta je dodato.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${shown.map(card).join("")}</table>` +
    (more > 0 ? `<p style="margin:0 0 20px;font:14px Arial,sans-serif;color:#8b93a7">Na sajtu ima još ${more} ${more === 1 ? "proizvod" : "proizvoda"}.</p>` : "") +
    `<p style="margin:0 0 28px"><a href="${S}/#proizvodi" style="color:#6fb1ff;font:600 15px Arial,sans-serif">Pogledaj sve proizvode →</a></p>` +
    `<p style="margin:0;padding:18px 0 26px;border-top:1px solid #1f2430;font:12px/1.6 Arial,sans-serif;color:#6b7387">Dobijaš ovaj mejl jer si se prijavio/la za obaveštenja o novom dropu na dripselect.rs. Pitanja: info@dripselect.rs. <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#8b93a7">Odjavi se</a></p>` +
    `</td></tr></table></td></tr></table></body></html>`;
  const text = `Novi drop je stigao\n\n` + shown.map((p) => `${p.name}${facts(p) ? "\n" + facts(p) : ""}\n${fmtPrice(p.price)}\n${S}/proizvod/${p.slug}\n`).join("\n") +
    (more > 0 ? `\nNa sajtu ima još ${more}.\n` : "") + `\nSvi proizvodi: ${S}/#proizvodi\n\nDobijaš ovaj mejl jer si se prijavio/la za obaveštenja o novom dropu. Odjava: {{{RESEND_UNSUBSCRIBE_URL}}}`;
  return { subject, html, text };
}

async function broadcast(env, items) {
  const seg = await ensureSegment(env);
  const m = buildDrop(items, env);
  const body = { segment_id: seg, from: env.DROP_FROM || "Drip Select <drop@mail.dripselect.rs>", name: "Drop " + new Date().toISOString().slice(0, 16), subject: m.subject, html: m.html, text: m.text, send: true };
  let r = await rs(env, "POST", "/broadcasts", { ...body, reply_to: env.DROP_REPLY_TO || "info@dripselect.rs" });
  if (!r.ok && r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 403 && r.status !== 429) r = await rs(env, "POST", "/broadcasts", body); // ako Resend ne prihvati reply_to
  if (!r.ok) throw fail("broadcast", r);
  return r.json && r.json.id;
}

// ---------- cron ----------
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export async function checkDrop(env, now = Date.now()) {
  const g = gh(env);
  if (!g || !apiKey(env)) return { skipped: "nije podešeno" };
  const lb = await loadBody(env, site(env), null);
  if (lb.err) return { skipped: "proizvodi nedostupni" };
  const all = parseProducts(JSON.parse(lb.body).items);
  const known = all.map((p) => p.file);
  const fresh = (list) => list.filter((p) => !p.sold);

  const st = await readState(g);
  if (st.missing) { // prvi put: sve što već postoji je "javljeno"
    await writeState(g, null, { announced: known.slice().sort(), pending: null }, "Drop: početno stanje");
    return { baseline: known.length };
  }
  const state = { announced: [], pending: null, ...st.s };
  const isNew = (p) => !state.announced.includes(p.file);
  const news = fresh(all).filter(isNew).map((p) => p.file).sort();
  // prodati proizvodi koji nikad nisu javljeni se ne javljaju kasnije kad se vrate u prodaju
  const quiet = all.filter((p) => p.sold && isNew(p)).map((p) => p.file);

  if (!news.length) {
    if (state.pending || quiet.length) {
      await writeState(g, st.sha, { ...state, announced: [...new Set([...state.announced, ...quiet])].sort(), pending: null }, "Drop: nema novih");
    }
    return { news: 0 };
  }
  const p0 = state.pending;
  if (!p0 || !same(p0.files, news)) { // nešto je dodato ili promenjeno: čekaj da se smiri
    await writeState(g, st.sha, { ...state, pending: { files: news, since: now, first: p0 ? p0.first : now } }, "Drop: čekam da se smiri");
    return { waiting: news.length };
  }
  if (now - p0.since < settleMs(env) && now - p0.first < MAX_WAIT_MS) return { waiting: news.length, settling: true };

  // vreme je za slanje. Prvo upiši "javljeno" (ako to ne uspe, ne šalje se; tako nema duplih mejlova), pa pošalji.
  const items = fresh(all).filter((p) => news.includes(p.file));
  const done = { ...state, announced: [...new Set([...state.announced, ...news, ...quiet])].sort(), pending: null };
  const sha2 = await writeState(g, st.sha, done, "Drop: javljeno pretplatnicima");
  try {
    const id = await broadcast(env, items);
    return { sent: items.length, id };
  } catch (e) {
    console.error("drop broadcast", e);
    const retry = e.status === 401 || e.status === 403 || e.status === 429 || !e.status || e.status >= 500;
    if (retry) { try { await writeState(g, sha2, { ...state, pending: p0 }, "Drop: slanje nije uspelo, pokušavam ponovo"); } catch (e2) { console.error("drop revert", e2); } }
    return { error: String(e.message).slice(0, 160), retry };
  }
}
