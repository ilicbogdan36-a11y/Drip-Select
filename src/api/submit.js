// Cloudflare Worker (src/worker.js): POST /api/submit
// Prima porudžbine i ostale forme sa sajta, šalje mejl vlasniku (Resend) i, za porudžbinu,
// odmah "rezerviše" proizvod (sold: true u GitHub fajlu) tako da ga niko drugi ne može poručiti.
//
// Telo (JSON): { form: "porudzbina"|"prijava"|"zelja"|"kontakt", data: {...}, files: [{filename, content(base64)}], bot: "" }
//
// Promenljive (Cloudflare > Workers > drip-select > Settings > Variables and Secrets):
//   GITHUB_TOKEN (secret)  fine-grained token, samo ovaj repo, Contents: Read and write
//   GH_OWNER, GH_REPO      npr. ilicbogdan36-a11y i Drip-Select
//   RESEND_API_KEY (secret), MAIL_TO (tvoj mejl; više njih odvoji zarezom)
//   opciono: GH_BRANCH (main), GH_FOLDER (content/proizvodi), MAIL_FROM

const MAX_BODY = 4000000;   // znakova; slike stižu već smanjene iz pregledača
const MAX_FILE = 1000000;   // znakova base64 po slici
const FILE_RE = /^[^\/\\|]+\.md$/;

const FORMS = {
  porudzbina: {
    title: "Nova porudžbina",
    req: ["ime", "prezime", "email", "telefon", "adresa", "grad", "postanski_broj", "artikli", "fajlovi"],
    all: ["ime", "prezime", "email", "telefon", "adresa", "grad", "postanski_broj", "drzava", "napomena", "artikli", "ukupno", "vreme", "fajlovi"],
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
  postanski_broj: "Poštanski broj", drzava: "Država", napomena: "Napomena", artikli: "Proizvodi",
  ukupno: "Ukupno", vreme: "Vreme", poruka: "Poruka", sta_trazi: "Šta traži", velicina: "Veličina", budzet: "Budžet (din.)",
};
const LONG = { poruka: 3000, napomena: 3000, artikli: 3000, sta_trazi: 1000, fajlovi: 1500 };

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
const isEmail = (s) => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

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

// ---------- Mejl (Resend) ----------
function buildMail(def, d, atts) {
  const keys = def.all.filter((k) => d[k] && k !== "fajlovi");
  const rows = keys.map((k) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#666;vertical-align:top;white-space:nowrap">${LABELS[k] || k}</td><td style="padding:6px 0">${esc(d[k]).replace(/\n/g, "<br>")}</td></tr>`).join("");
  const note = def === FORMS.porudzbina ? '<p style="color:#666;font-size:13px">Proizvodi iz ove porudžbine su automatski označeni kao prodati na sajtu.</p>' : "";
  const att = atts.length ? `<p style="color:#666;font-size:13px">U prilogu: ${atts.length} slika.</p>` : "";
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111"><h2 style="margin:0 0 14px">${def.title}</h2><table style="border-collapse:collapse">${rows}</table>${note}${att}</div>`;
  const text = `${def.title}\n\n` + keys.map((k) => `${LABELS[k] || k}: ${d[k]}`).join("\n");
  let subject = def.title;
  if (d.ime) subject += `: ${d.ime}${d.prezime ? " " + d.prezime : ""}`;
  else if (d.email) subject += `: ${d.email}`;
  if (d.ukupno) subject += ` (${d.ukupno})`;
  return { subject: subject.replace(/\s+/g, " ").slice(0, 150), html, text };
}
async function sendMail(env, mail, replyTo, attachments) {
  const to = String(env.MAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
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

// ---------- Handler ----------
export async function onRequestPost({ request, env }) {
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

  const d = {};
  for (const k of def.all) d[k] = clean(body.data && body.data[k], LONG[k] || 300);
  for (const k of def.req) if (!d[k]) return json({ error: "missing", field: k }, 400);
  if (d.email && !isEmail(d.email)) return json({ error: "email" }, 400);

  const atts = [];
  if (body.form === "zelja" && Array.isArray(body.files)) {
    body.files.slice(0, 4).forEach((f, i) => {
      if (!f || typeof f.content !== "string" || !f.content || f.content.length > MAX_FILE) return;
      const ext = (String(f.filename || "").match(/\.(jpe?g|png|webp|gif)$/i) || [, "jpg"])[1].toLowerCase();
      atts.push({ filename: `slika-${i + 1}.${ext}`, content: f.content });
    });
  }

  let cfg = null, reserved = [];
  if (body.form === "porudzbina") {
    const files = d.fajlovi.split("|").map((s) => s.trim()).filter(Boolean);
    if (!files.length || files.length > 10 || !files.every((f) => FILE_RE.test(f))) return json({ error: "missing", field: "fajlovi" }, 400);
    cfg = ghCfg(env);
    if (!cfg) return json({ error: "config" }, 500);
    let res;
    try { res = await reserve(cfg, [...new Set(files)]); }
    catch (e) { console.error("reserve", e); return json({ error: "github" }, 502); }
    if (res.conflict) return json({ error: "sold", items: res.conflict }, 409);
    reserved = res.done;
  }

  try {
    await sendMail(env, buildMail(def, d, atts), d.email && isEmail(d.email) ? d.email : null, atts);
  } catch (e) {
    console.error("mail", e);
    if (reserved.length) await rollback(cfg, reserved); // mejl nije otišao: vrati proizvode u prodaju
    return json({ error: "mail" }, 502);
  }
  return json({ ok: true });
}

export const onRequest = () => json({ error: "method" }, 405);
