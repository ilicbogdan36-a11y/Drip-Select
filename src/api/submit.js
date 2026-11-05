// Cloudflare Worker (src/worker.js): POST /api/submit
// Prima porudžbine i ostale forme sa sajta i šalje mejl vlasniku (Resend).
// Porudžbina NE označava proizvod kao prodat: mejl vlasniku nosi dugmad Prihvati / Odbij (src/api/odluka.js),
// a tek prihvatanje upisuje sold: true u GitHub fajl. Dok se ne odluči, na sajtu se ništa ne menja.
//
// Telo (JSON): { form: "porudzbina"|"prijava"|"zelja"|"kontakt", data: {...}, files: [{filename, content(base64)}], bot: "", t: ms }
//   bot = skriveno polje koje čovek ne vidi (botovi ga popune), t = koliko je ms prošlo od prikaza forme.
// Posle uspešne porudžbine kupac dobija mejl potvrde (reply_to = info@dripselect.rs, može da se promeni sa MAIL_REPLY).
// Zaštita: honeypot, minimalno vreme popunjavanja, ograničenje po IP adresi (RL_ORDERS / RL_FORMS u 10 min), provera podataka.
//
// Promenljive (Cloudflare > Workers > drip-select > Settings > Variables and Secrets):
//   GITHUB_TOKEN (secret)  fine-grained token, samo ovaj repo, Contents: Read and write
//   GH_OWNER, GH_REPO      npr. ilicbogdan36-a11y i Drip-Select
//   RESEND_API_KEY (secret), MAIL_TO (tvoj mejl; više njih odvoji zarezom)
//   opciono: GH_BRANCH (main), GH_FOLDER (content/proizvodi), MAIL_FROM

import { addSubscriber } from "../drop.js";
import { signDecision, DECISION_DAYS } from "../decision.js";

const MAX_BODY = 4000000;   // znakova; slike stižu već smanjene iz pregledača
const MAX_FILE = 1000000;   // znakova base64 po slici
const FILE_RE = /^[^\/\\|]+\.md$/;
const MIN_FILL_MS = 1200;          // brže od ovoga forma nije popunjena rukom
const RL_WINDOW = 600;             // sekundi
const RL_ORDERS = 5, RL_FORMS = 12; // pokušaja po IP adresi u prozoru: porudžbine / sve ostale forme
const CONFIRM_MAX = 3;             // mejlova potvrde po adresi kupca na sat (sprečava da neko tuđu adresu zaspe mejlovima)
const REPLY_DEFAULT = "info@dripselect.rs";

const FORMS = {
  porudzbina: {
    title: "Nova porudžbina",
    req: ["ime", "prezime", "email", "telefon", "adresa", "grad", "postanski_broj", "artikli", "fajlovi"],
    all: ["ime", "prezime", "email", "telefon", "adresa", "grad", "postanski_broj", "drzava", "napomena", "novosti", "artikli", "dostava", "placanje", "ukupno", "vreme", "fajlovi"],
  },
  prijava: { title: "Prijava za novi drop", req: ["email"], all: ["email", "vreme"] },
  zelja: {
    title: "Zahtev: Naruči po želji",
    req: ["ime", "telefon", "email", "sta_trazi", "velicina"],
    all: ["ime", "telefon", "email", "sta_trazi", "velicina", "budzet", "napomena", "vreme"],
  },
  kontakt: { title: "Poruka sa sajta", req: ["ime", "email", "poruka"], all: ["ime", "email", "poruka", "vreme"] },
};
const LABELS = {
  ime: "Ime", prezime: "Prezime", email: "Mejl", telefon: "Telefon", adresa: "Adresa", grad: "Grad",
  postanski_broj: "Poštanski broj", drzava: "Država", napomena: "Napomena", artikli: "Proizvodi", dostava: "Dostava", placanje: "Plaćanje",
  novosti: "Novosti i ponude mejlom", ukupno: "Ukupno", vreme: "Vreme", poruka: "Poruka", sta_trazi: "Šta traži", velicina: "Veličina", budzet: "Budžet (din.)",
};
const LONG = { poruka: 3000, napomena: 3000, artikli: 3000, sta_trazi: 1000, fajlovi: 1500 };

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
const isEmail = (s) => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const lim = (v, def) => (+v > 0 ? +v : def);

// ---------- zaštita od botova i zloupotrebe ----------
async function sha(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Brojač pokušaja u vremenskom prozoru, bez dodatne infrastrukture: memorija ovog Worker-a + Cache API (deli se između
// instanci u istom data centru; na workers.dev adresi ne radi, tada ostaje samo memorija). Nije savršeno, ali zaustavlja
// jednostavno zasipanje. U ključu je samo skraćeni hash, a zapis sam nestaje posle prozora.
const memHits = new Map();
async function hit(key, windowSec) {
  const now = Date.now();
  let m = memHits.get(key);
  if (!m || m.exp <= now) {
    if (memHits.size > 5000) for (const [k, v] of memHits) if (v.exp <= now) memHits.delete(k);
    m = { c: 0, exp: now + windowSec * 1000 };
    memHits.set(key, m);
  }
  m.c++;
  let c = m.c;
  try {
    if (typeof caches !== "undefined") {
      const req = new Request("https://rl.dripselect.internal/" + encodeURIComponent(key));
      const got = await caches.default.match(req);
      let o = got ? await got.json().catch(() => null) : null;
      if (!o || o.exp <= now) o = { c: 0, exp: now + windowSec * 1000 };
      o.c++;
      await caches.default.put(req, new Response(JSON.stringify(o), { headers: { "cache-control": "max-age=" + Math.max(1, Math.ceil((o.exp - now) / 1000)) } }));
      c = Math.max(c, o.c);
    }
  } catch (e) { console.error("rate", e); }
  return c;
}
// Vraća ime polja sa očigledno lošim podacima (linkovi u imenu/adresi, previše linkova u tekstu, nemoguć telefon) ili "".
const LINK_RE = /https?:\/\/|www\./gi;
function badData(d) {
  for (const k of ["ime", "prezime", "adresa", "grad"]) if (d[k] && /https?:\/\/|www\./i.test(d[k])) return k;
  for (const k of ["napomena", "poruka", "sta_trazi"]) if (d[k] && (d[k].match(LINK_RE) || []).length > 2) return k;
  if (d.telefon) { const n = d.telefon.replace(/\D/g, "").length; if (n < 6 || n > 16) return "telefon"; }
  return "";
}

// ---------- GitHub (sold: true u frontmatter-u) ----------
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
const b64encode = (text) => { let s = ""; for (const b of new TextEncoder().encode(text)) s += String.fromCharCode(b); return btoa(s); };

function readSold(t) {
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return !!m && /^sold:\s*["']?(true|da|yes|1)["']?\s*$/im.test(m[1]);
}
function setSold(t, val) {
  const m = t.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) return null;
  const fm = /^sold:.*$/m.test(m[2]) ? m[2].replace(/^sold:.*$/m, `sold: ${val}`) : `${m[2]}\nsold: ${val}`;
  return t.slice(0, m.index) + m[1] + fm + m[3] + t.slice(m.index + m[0].length);
}

function ghCfg(env) {
  if (!env.GITHUB_TOKEN || !env.GH_OWNER || !env.GH_REPO) return null;
  const folder = env.GH_FOLDER || "content/proizvodi";
  return {
    url: `${env.GITHUB_API || "https://api.github.com"}/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${folder}`,
    branch: env.GH_BRANCH || "main",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "drip-select",
      "Content-Type": "application/json",
    },
  };
}
async function readFile(cfg, file) {
  const r = await fetch(`${cfg.url}/${encodeURIComponent(file)}?ref=${encodeURIComponent(cfg.branch)}`, { headers: cfg.headers });
  if (r.status === 404) return { missing: true };
  if (!r.ok) throw new Error("github read " + r.status);
  const j = await r.json();
  return { sha: j.sha, text: b64decode(j.content || "") };
}
const writeFile = (cfg, file, text, sha, message) =>
  fetch(`${cfg.url}/${encodeURIComponent(file)}`, {
    method: "PUT",
    headers: cfg.headers,
    body: JSON.stringify({ message, content: b64encode(text), sha, branch: cfg.branch }),
  });

async function rollback(cfg, done) {
  for (const d of done) {
    try { await writeFile(cfg, d.file, d.orig, d.sha, `Vraćeno u prodaju: ${d.file} [skip ci]`); } catch (e) { console.error("rollback", d.file, e); }
  }
}
// Proveri da li su svi slobodni, pa ih jedan po jedan označi kao prodate. GitHub odbija upis ako se fajl u međuvremenu
// promenio (sha), pa dvoje ljudi ne mogu istovremeno da poruče isti proizvod.
async function reserve(cfg, files) {
  const state = [];
  for (const f of files) {
    const r = await readFile(cfg, f);
    if (r.missing) return { conflict: [f] };
    state.push({ file: f, ...r });
  }
  const taken = state.filter((s) => readSold(s.text)).map((s) => s.file);
  if (taken.length) return { conflict: taken };
  const done = [];
  for (const s of state) {
    const next = setSold(s.text, "true");
    if (next == null) { await rollback(cfg, done); throw new Error("format " + s.file); }
    const r = await writeFile(cfg, s.file, next, s.sha, `Prodato: ${s.file} [skip ci]`);
    if (r.status === 409 || r.status === 422) { await rollback(cfg, done); return { conflict: [s.file] }; }
    if (!r.ok) { await rollback(cfg, done); throw new Error("github write " + r.status); }
    const j = await r.json();
    done.push({ file: s.file, orig: s.text, sha: j.content.sha });
  }
  return { done };
}

// Samo proverava da li su proizvodi još slobodni (ništa ne upisuje): porudžbina ih ne zaključava, to radi tek "Prihvati".
async function available(cfg, files) {
  const taken = [];
  for (const f of files) {
    const r = await readFile(cfg, f);
    if (r.missing || readSold(r.text)) taken.push(f);
  }
  return taken;
}

// ---------- Mejl (Resend) ----------
function buildMail(def, d, atts, extra = "", links = null) {
  const keys = def.all.filter((k) => d[k] && k !== "fajlovi");
  const rows = keys.map((k) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#666;vertical-align:top;white-space:nowrap">${LABELS[k] || k}</td><td style="padding:6px 0">${esc(d[k]).replace(/\n/g, "<br>")}</td></tr>`).join("");
  const btn = (href, bg, label) => `<a href="${esc(href)}" style="display:inline-block;padding:12px 22px;background:${bg};color:#fff;text-decoration:none;font-weight:bold;border-radius:8px">${label}</a>`;
  const note = def === FORMS.porudzbina && links
    ? `<p style="margin:18px 0 10px"><b>Odluči o porudžbini.</b> Proizvodi još NISU označeni kao prodati i na sajtu se ništa nije promenilo.</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px">${btn(links.accept, "#16a34a", "Prihvati porudžbinu")}</td><td>${btn(links.decline, "#dc2626", "Odbij porudžbinu")}</td></tr></table>` +
      `<p style="color:#666;font-size:13px">Prihvatanje označava proizvode kao prodate i šalje kupcu potvrdu. Odbijanje ostavlja proizvode u prodaji i šalje kupcu obaveštenje. Linkovi važe ${DECISION_DAYS} dana; ne prosleđuj ovaj mejl, jer ko ima link može da odluči o porudžbini.</p>`
    : "";
  const att = atts.length ? `<p style="color:#666;font-size:13px">U prilogu: ${atts.length} slika.</p>` : "";
  const ex = extra ? `<p style="color:#666;font-size:13px">${esc(extra)}</p>` : "";
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111"><h2 style="margin:0 0 14px">${def.title}</h2>${note}<table style="border-collapse:collapse;margin-top:16px">${rows}</table>${att}${ex}</div>`;
  const text = `${def.title}\n\n` + keys.map((k) => `${LABELS[k] || k}: ${d[k]}`).join("\n") +
    (def === FORMS.porudzbina && links ? `\n\nProizvodi još NISU označeni kao prodati. Odluči o porudžbini:\nPRIHVATI: ${links.accept}\nODBIJ: ${links.decline}\n(Linkovi važe ${DECISION_DAYS} dana; ne prosleđuj ovaj mejl.)` : "") +
    (extra ? `\n\n${extra}` : "");
  let subject = def.title;
  if (d.ime) subject += `: ${d.ime}${d.prezime ? " " + d.prezime : ""}`;
  else if (d.email) subject += `: ${d.email}`;
  if (d.ukupno) subject += ` (${d.ukupno})`;
  return { subject: subject.replace(/\s+/g, " ").slice(0, 150), html, text };
}
async function sendMail(env, mail, replyTo, attachments, toOne) {
  const to = toOne ? [toOne] : String(env.MAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!env.RESEND_API_KEY || !to.length) throw new Error("mejl nije podešen (RESEND_API_KEY / MAIL_TO)");
  const body = { from: env.MAIL_FROM || "Drip Select <onboarding@resend.dev>", to, subject: mail.subject, html: mail.html, text: mail.text };
  if (replyTo) body.reply_to = replyTo;
  if (attachments.length) body.attachments = attachments;
  const r = await fetch(env.RESEND_API || "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`resend ${r.status} ${(await r.text()).slice(0, 300)}`);
}

// Potvrda porudžbine za kupca. Tekst prati ono što kupac vidi na strani "Hvala na porudžbini", bez novih obećanja.
function buildCustomerMail(d, env) {
  const site = String(env.SITE_URL || "https://dripselect.rs").replace(/\/+$/, "");
  const contact = env.MAIL_REPLY || REPLY_DEFAULT;
  const abroad = /^Unapred/i.test(d.placanje);
  const addr = [d.adresa, [d.postanski_broj, d.grad].filter(Boolean).join(" "), d.drzava].filter(Boolean).join(", ");
  const next = abroad
    ? "Javljamo ti se radi cene dostave i podataka za uplatu. Paket šaljemo kad uplata stigne."
    : "Javljamo se na telefon radi potvrde, a zatim dogovaramo dostavu. Plaćanje je pouzećem, gotovinom kuriru pri preuzimanju.";
  const rows = [["Proizvodi", d.artikli], ["Dostava", d.dostava], ["Ukupno", d.ukupno], ["Plaćanje", d.placanje], ["Adresa", addr], ["Telefon", d.telefon], ["Napomena", d.napomena]].filter(([, v]) => v);
  const hello = d.ime ? `Zdravo, ${d.ime}.` : "Zdravo.";
  const trs = rows.map(([k, v]) =>
    `<tr><td style="padding:7px 18px 7px 0;font:14px Arial,sans-serif;color:#8b93a7;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:7px 0;font:15px Arial,sans-serif;color:#f4f6fa">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("");
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#07080c" bgcolor="#07080c">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">Primili smo tvoju porudžbinu i uskoro ćemo je obraditi.</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#07080c"><tr><td align="center" style="padding:28px 14px">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px" bgcolor="#0f121a"><tr><td style="padding:28px 20px 6px">` +
    `<div style="font:700 13px Arial,sans-serif;letter-spacing:3px;color:#6fb1ff">DRIP SELECT</div>` +
    `<h1 style="margin:10px 0 6px;font:700 26px Arial,sans-serif;color:#f4f6fa">Hvala na porudžbini!</h1>` +
    `<p style="margin:0 0 6px;font:15px/1.5 Arial,sans-serif;color:#cbd5e6">${esc(hello)} Primili smo tvoju porudžbinu i uskoro ćemo je obraditi.</p>` +
    `<p style="margin:0 0 22px;font:15px/1.5 Arial,sans-serif;color:#8b93a7">${next}</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px">${trs}</table>` +
    `<p style="margin:0 0 26px;font:14px/1.5 Arial,sans-serif;color:#8b93a7">Ako je neki podatak pogrešan (telefon ili adresa), odgovori na ovaj mejl i ispravićemo ga.</p>` +
    `<p style="margin:0;padding:18px 0 26px;border-top:1px solid #1f2430;font:12px/1.6 Arial,sans-serif;color:#6b7387">Ovo je automatska potvrda porudžbine na <a href="${esc(site)}" style="color:#8b93a7">dripselect.rs</a>. Pitanja: ${esc(contact)}.</p>` +
    `</td></tr></table></td></tr></table></body></html>`;
  const text = `Hvala na porudžbini!\n\n${hello} Primili smo tvoju porudžbinu i uskoro ćemo je obraditi.\n${next}\n\n` + rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\nAko je neki podatak pogrešan (telefon ili adresa), odgovori na ovaj mejl i ispravićemo ga.\n\nOvo je automatska potvrda porudžbine na ${site}. Pitanja: ${contact}.`;
  return { subject: "Primili smo tvoju porudžbinu | Drip Select", html, text };
}
async function confirmCustomer(env, d) {
  const n = await hit("c:" + (await sha(d.email.toLowerCase())), 3600);
  if (n > CONFIRM_MAX) { console.warn("potvrda: previše porudžbina sa iste adrese, mejl nije poslat"); return; }
  await sendMail(env, buildCustomerMail(d, env), env.MAIL_REPLY || REPLY_DEFAULT, [], d.email);
}

// Posle upisa u GitHub obriši keš liste proizvoda, da SOLD OUT bude vidljiv odmah (najbolji pokušaj)
function purge(request, waitUntil) {
  try {
    if (typeof caches === "undefined") return;
    const p = caches.default.delete(new Request(new URL(request.url).origin + "/api/products"));
    if (waitUntil) waitUntil(p.catch(() => {}));
  } catch (e) { console.error("purge", e); }
}

// ---------- Handler ----------
export async function onRequestPost({ request, env, waitUntil }) {
  const origin = request.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== new URL(request.url).host) return json({ error: "origin" }, 403); }
    catch { return json({ error: "origin" }, 403); }
  }
  if ((+request.headers.get("content-length") || 0) > MAX_BODY) return json({ error: "too_big" }, 413);

  let body;
  try {
    const txt = await request.text();
    if (txt.length > MAX_BODY) return json({ error: "too_big" }, 413);
    body = JSON.parse(txt);
  } catch { return json({ error: "bad_json" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "bad_json" }, 400);

  if (body.bot) return json({ ok: true }); // honeypot: botovi ne dobijaju grešku
  const def = FORMS[body.form];
  if (!def) return json({ error: "form" }, 400);
  // vreme od prikaza forme: mora da postoji (pravi sajt ga uvek šalje), a prebrzo znači bot ili automatsko slanje
  if (typeof body.t !== "number" || !Number.isFinite(body.t) || body.t < 0) return json({ error: "form" }, 400);
  if (body.t < lim(env.MIN_FILL_MS, MIN_FILL_MS)) return json({ error: "fast" }, 429);
  // ograničenje po IP adresi (cf-connecting-ip postavlja Cloudflare, klijent ga ne može lažirati)
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) {
    const isOrder = body.form === "porudzbina";
    const n = await hit((isOrder ? "o:" : "f:") + (await sha(ip)), RL_WINDOW);
    if (n > (isOrder ? lim(env.RL_ORDERS, RL_ORDERS) : lim(env.RL_FORMS, RL_FORMS))) return json({ error: "rate" }, 429);
  }

  const d = {};
  for (const k of def.all) d[k] = clean(body.data && body.data[k], LONG[k] || 300);
  if ("novosti" in d) d.novosti = d.novosti === "Da" ? "Da" : "Ne";
  for (const k of def.req) if (!d[k]) return json({ error: "missing", field: k }, 400);
  if (d.email && !isEmail(d.email)) return json({ error: "email" }, 400);
  const bad = badData(d);
  if (bad) return json({ error: "invalid", field: bad }, 400);

  const atts = [];
  if (body.form === "zelja" && Array.isArray(body.files)) {
    body.files.slice(0, 4).forEach((f, i) => {
      if (!f || typeof f.content !== "string" || !f.content || f.content.length > MAX_FILE) return;
      const ext = (String(f.filename || "").match(/\.(jpe?g|png|webp|gif)$/i) || [, "jpg"])[1].toLowerCase();
      atts.push({ filename: `slika-${i + 1}.${ext}`, content: f.content });
    });
  }

  let cfg = null, files = [];
  if (body.form === "porudzbina") {
    files = [];
    files = [...new Set(d.fajlovi.split("|").map((s) => s.trim()).filter(Boolean))];
    if (!files.length || files.length > 10 || !files.every((f) => FILE_RE.test(f))) return json({ error: "missing", field: "fajlovi" }, 400);
    cfg = ghCfg(env);
    if (!cfg) return json({ error: "config" }, 500);
    let taken;
    try { taken = await available(cfg, files); }
    catch (e) { console.error("available", e); return json({ error: "github" }, 502); }
    if (taken.length) return json({ error: "sold", items: taken }, 409);
  }

  // prijava za drop: upiši mejl u listu pretplatnika (Resend); neuspeh ne sme da blokira prijavu, ali vlasnik dobija napomenu u mejlu
  let extra = "";
  if (body.form === "prijava") {
    try {
      const r = await addSubscriber(env, d.email);
      if (!r.skipped) extra = "Upisan u listu pretplatnika za novi drop.";
    } catch (e) {
      console.error("subscribe", e);
      extra = "UPOZORENJE: ova adresa NIJE upisana u listu pretplatnika (" + String(e.message).slice(0, 120) + "). Proveri Resend ključ (potreban je Full access) i javi se.";
    }
  }

  // dugmad Prihvati / Odbij: potpisani linkovi ka /api/odluka (isti sajt sa kog je porudžbina stigla)
  let links = null;
  if (body.form === "porudzbina") {
    try {
      const tok = await signDecision(env, { f: files, e: d.email, n: d.ime, a: d.artikli.slice(0, 600), u: d.ukupno, p: d.placanje, d: d.dostava });
      const base = new URL(request.url).origin + "/api/odluka?t=" + tok;
      links = { accept: base + "&a=prihvati", decline: base + "&a=odbij" };
    } catch (e) { console.error("potpis", e); return json({ error: "config" }, 500); }
  }
  try {
    await sendMail(env, buildMail(def, d, atts, extra, links), d.email && isEmail(d.email) ? d.email : null, atts);
  } catch (e) {
    console.error("mail", e);
    return json({ error: "mail" }, 502); // mejl nije otišao: porudžbina nije primljena, kupac može da pokuša ponovo (ništa nije zaključano)
  }
  // potvrda za kupca: njen neuspeh ne sme da pokvari porudžbinu koja je već primljena
  if (body.form === "porudzbina" && d.email) {
    const task = confirmCustomer(env, d).catch((e) => console.error("mejl kupcu", e));
    if (waitUntil) waitUntil(task); else await task;
  }
  return json({ ok: true });
}

export { ghCfg, readFile, readSold, reserve, sendMail, esc, sha, purge, REPLY_DEFAULT };
export const onRequest = () => json({ error: "method" }, 405);
