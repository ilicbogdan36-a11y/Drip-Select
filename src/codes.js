// Kodovi za popust i točak. Jedan JSON fajl po kodu u content/kodovi (GitHub je baza, isto kao proizvodi), pa admin (Decap)
// vidi i menja iste fajlove koje koristi server. Podešavanja (točak uključen/isključen, prag, rok) su u content/podesavanja/tocak.json.
//
// Kod (JSON): { kod, vrsta, status, nastao, rok_dana, napomena, ishod, email, porudzbina }
//   vrsta  : p5 | p10 | p20 | dostava | artikal | tocak   (tocak = nagrada se izvlači tek kad kupac zavrti)
//   ishod  : za vrstu tocak, ono što je izvučeno (nista | p5 | p10 | p20 | dostava | artikal), inače prazno
//   status : aktivan | zakljucan (kod je u porudžbini koja čeka odluku) | iskoriscen
// Kod je jednokratan: upis u GitHub ide sa sha proverom, pa dve istovremene porudžbine ne mogu da potroše isti kod.
// Svi iznosi se računaju na serveru iz cena u fajlovima proizvoda; cena koju pošalje pregledač se ne uzima u obzir.

const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\s/g, "")), (c) => c.charCodeAt(0)));
const b64encode = (text) => { let s = ""; for (const b of new TextEncoder().encode(text)) s += String.fromCharCode(b); return btoa(s); };

export const KOD_DIR = "content/kodovi";
export const SETT_DIR = "content/podesavanja";
export const SETT_FILE = "tocak.json";
export const DEFAULTS = { tocak: false, prag: 15000, rok_dana: 30 };
export const MAX_ARTIKAL = 20000;

// Nagrade točka i šanse (zbir je 100). "ponovo" ne troši kod.
export const SANSE = [
  { id: "nista", w: 49, naziv: "Probaj sledeći put" },
  { id: "dostava", w: 10, naziv: "Besplatna dostava" },
  { id: "p5", w: 12, naziv: "5% popust" },
  { id: "p10", w: 11, naziv: "10% popust" },
  { id: "p20", w: 7, naziv: "20% popust" },
  { id: "ponovo", w: 10, naziv: "Zavrti ponovo" },
  { id: "artikal", w: 1, naziv: "Artikal do 20.000 din." },
];
const PRIZE = {
  p5: { id: "p5", tip: "popust", vrednost: 5 },
  p10: { id: "p10", tip: "popust", vrednost: 10 },
  p20: { id: "p20", tip: "popust", vrednost: 20 },
  dostava: { id: "dostava", tip: "dostava" },
  artikal: { id: "artikal", tip: "artikal", max: MAX_ARTIKAL },
};
const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " din.";
export const opisNagrade = (p) =>
  p.tip === "popust" ? `${p.vrednost}% popust na jedan artikal po izboru`
    : p.tip === "dostava" ? "Besplatna dostava"
      : p.tip === "artikal" ? `Jedan artikal po izboru, do ${fmt(p.max)}, besplatno` : "";
export const javnaNagrada = (p) => (p ? { ...p, opis: opisNagrade(p) } : null);

// ---------- pomoćno ----------
export const normKod = (s) => {
  const k = String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9][A-Z0-9-]{3,23}$/.test(k) ? k : "";
};
const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 znaka, bez I, O, 0, 1
export function noviKod() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  const s = [...b].map((x) => ABC[x & 31]).join("");
  return `DRIP-${s.slice(0, 4)}-${s.slice(4)}`;
}
export const rand01 = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
export function izvuci(rnd = rand01) {
  let r = rnd() * 100;
  for (const s of SANSE) { if (r < s.w) return s.id; r -= s.w; }
  return "nista";
}
// cena iz frontmatter-a fajla proizvoda (0 ako je nema)
export function priceOf(text) {
  const m = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const p = m && m[1].match(/^price:\s*["']?([\d.,]+)/im);
  const n = p ? parseFloat(p[1].replace(",", ".")) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}
export const fmtDin = fmt;
export function rokDatum(k) {
  const t = Date.parse(k && k.nastao);
  if (!Number.isFinite(t)) return null;
  const dana = +k.rok_dana > 0 ? +k.rok_dana : DEFAULTS.rok_dana;
  return t + dana * 86400000;
}
export const datumTxt = (ms) => { const d = new Date(ms); return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}.`; };

// stanje koda: s = vazi | zavrti | zakljucan | iskoriscen | istekao | nema
export function stanje(k, now = Date.now()) {
  if (!k || typeof k !== "object") return { s: "nema" };
  if (k.status === "iskoriscen") return { s: "iskoriscen" };
  const rok = rokDatum(k);
  if (rok != null && now > rok) return { s: "istekao", rok };
  if (k.status === "zakljucan") return { s: "zakljucan", rok };
  if (k.vrsta === "tocak") {
    if (!k.ishod) return { s: "zavrti", rok };
    const p = PRIZE[k.ishod];
    return p ? { s: "vazi", prize: p, rok } : { s: "iskoriscen" };
  }
  const p = PRIZE[k.vrsta];
  return p ? { s: "vazi", prize: p, rok } : { s: "nema" };
}

// Popust za nagradu na konkretnim komadima. items: [{file, price}], izbor: fajl koji je kupac izabrao.
export function racun(prize, items, izbor) {
  if (prize.tip === "dostava") return { ok: true, iznos: 0, dostava: true };
  let it = items.find((x) => x.file === izbor);
  if (!it && items.length === 1) it = items[0];
  if (!it) return { ok: false, razlog: "izbor" };
  if (!(it.price > 0)) return { ok: false, razlog: "cena" };
  if (prize.tip === "popust") return { ok: true, iznos: Math.round((it.price * prize.vrednost) / 100), stavka: it };
  if (prize.tip === "artikal") return it.price > prize.max ? { ok: false, razlog: "skupo" } : { ok: true, iznos: it.price, stavka: it };
  return { ok: false, razlog: "nema" };
}

// ---------- GitHub ----------
function cfgAt(env, dir) {
  if (!env.GITHUB_TOKEN || !env.GH_OWNER || !env.GH_REPO) return null;
  return {
    url: `${env.GITHUB_API || "https://api.github.com"}/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${dir}`,
    branch: env.GH_BRANCH || "main",
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "drip-select", "Content-Type": "application/json" },
  };
}
async function gget(cfg, name) {
  const r = await fetch(`${cfg.url}/${encodeURIComponent(name)}?ref=${encodeURIComponent(cfg.branch)}`, { headers: cfg.headers });
  if (r.status === 404) return { missing: true };
  if (!r.ok) throw new Error("github read " + r.status);
  const j = await r.json();
  return { sha: j.sha, text: b64decode(j.content || "") };
}
const gput = (cfg, name, text, sha, message) =>
  fetch(`${cfg.url}/${encodeURIComponent(name)}`, { method: "PUT", headers: cfg.headers, body: JSON.stringify({ message, content: b64encode(text), sha, branch: cfg.branch }) });
const conflict = (r) => r.status === 409 || r.status === 422;
const toJson = (o) => JSON.stringify(o, null, 2) + "\n";
const parse = (t) => { try { const o = JSON.parse(t); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; } };

// ---------- podešavanja ----------
let settCache = null;
export async function getSettings(env) {
  const ttl = Number.isFinite(+env.KOD_CFG_TTL) && env.KOD_CFG_TTL !== undefined && env.KOD_CFG_TTL !== "" ? +env.KOD_CFG_TTL : 20000;
  if (settCache && Date.now() - settCache.t < ttl) return settCache.v;
  let v = { ...DEFAULTS }, ok = false;
  try {
    const cfg = cfgAt(env, SETT_DIR);
    if (cfg) {
      const r = await gget(cfg, SETT_FILE);
      ok = true;
      const o = r.missing ? null : parse(r.text);
      if (o) {
        v.tocak = o.tocak === true || /^(true|da|yes|1)$/i.test(String(o.tocak ?? ""));
        if (+o.prag > 0) v.prag = +o.prag;
        if (+o.rok_dana >= 1 && +o.rok_dana <= 365) v.rok_dana = Math.round(+o.rok_dana);
      }
    }
  } catch (e) { console.error("podesavanja", e); }
  if (ok) settCache = { t: Date.now(), v };
  return v;
}

// ---------- kodovi ----------
async function ucitaj(cfg, kod) {
  for (const n of [kod.toLowerCase(), kod]) {   // server piše malim slovima, a admin može da upiše i velikim
    const name = n + ".json";
    const r = await gget(cfg, name);
    if (!r.missing) return { name, sha: r.sha, text: r.text, data: parse(r.text) };
  }
  return null;
}
export async function nadjiKod(env, kod) {
  const cfg = cfgAt(env, KOD_DIR);
  if (!cfg) throw new Error("github nije podešen");
  const e = await ucitaj(cfg, kod);
  return e && e.data ? e : null;
}

// Nasumično izvlačenje (samo kod koji je za točak i još nije zavrten). Rezultat se upisuje pre odgovora, pa ga nije moguće ponoviti.
export async function zavrtiKod(env, kod, rnd = rand01) {
  const cfg = cfgAt(env, KOD_DIR);
  if (!cfg) throw new Error("github nije podešen");
  for (let i = 0; i < 3; i++) {
    const e = await ucitaj(cfg, kod);
    if (!e || !e.data) return { ok: false, razlog: "nema" };
    const st = stanje(e.data);
    if (e.data.vrsta !== "tocak") return { ok: false, razlog: st.s === "vazi" ? "nije_za_tocak" : st.s };
    if (st.s === "vazi") return { ok: true, vec: true, id: e.data.ishod, nagrada: javnaNagrada(st.prize), stanje: "vazi", rok: st.rok };
    if (st.s !== "zavrti") return { ok: false, razlog: st.s };
    const id = izvuci(rnd);
    if (id === "ponovo") return { ok: true, id, stanje: "zavrti", rok: st.rok };
    const next = { ...e.data, ishod: id, status: id === "nista" ? "iskoriscen" : e.data.status || "aktivan", zavrteno: new Date().toISOString() };
    const r = await gput(cfg, e.name, toJson(next), e.sha, `Točak: ${kod} [skip ci]`);
    if (conflict(r)) continue;   // neko je u međuvremenu promenio kod: pročitaj ponovo
    if (!r.ok) throw new Error("github write " + r.status);
    return { ok: true, id, nagrada: javnaNagrada(PRIZE[id] || null), stanje: id === "nista" ? "gotovo" : "vazi", rok: st.rok };
  }
  return { ok: false, razlog: "zauzeto" };
}

// Zaključava kod za porudžbinu koja čeka odluku. Vraća i izračunat popust, da server ne veruje ceni iz pregledača.
export async function zakljucajKod(env, kod, items, izbor, info, abroad) {
  const cfg = cfgAt(env, KOD_DIR);
  if (!cfg) throw new Error("github nije podešen");
  const e = await ucitaj(cfg, kod);
  if (!e || !e.data) return { ok: false, razlog: "nema" };
  const st = stanje(e.data);
  if (st.s !== "vazi") return { ok: false, razlog: st.s === "zavrti" ? "zavrti" : st.s };
  if (st.prize.tip === "dostava" && abroad) return { ok: false, razlog: "dostava_ab" };
  const c = racun(st.prize, items, izbor);
  if (!c.ok) return { ok: false, razlog: c.razlog };
  const next = { ...e.data, status: "zakljucan", porudzbina: String(info || "").slice(0, 200) };
  const r = await gput(cfg, e.name, toJson(next), e.sha, `Kod u porudžbini: ${kod} [skip ci]`);
  if (conflict(r)) return { ok: false, razlog: "zakljucan" };
  if (!r.ok) throw new Error("github write " + r.status);
  return { ok: true, iznos: c.iznos, dostava: !!c.dostava, stavka: c.stavka || null, prize: st.prize, opis: opisNagrade(st.prize) };
}

async function promeni(env, kod, fn, poruka) {
  const cfg = cfgAt(env, KOD_DIR);
  if (!cfg) throw new Error("github nije podešen");
  for (let i = 0; i < 3; i++) {
    const e = await ucitaj(cfg, kod);
    if (!e || !e.data) return false;
    const next = fn(e.data);
    if (!next) return false;
    const r = await gput(cfg, e.name, toJson(next), e.sha, `${poruka}: ${kod} [skip ci]`);
    if (conflict(r)) continue;
    if (!r.ok) throw new Error("github write " + r.status);
    return true;
  }
  return false;
}
// Odbijena porudžbina ili neuspelo slanje: kod se vraća kupcu
export const otkljucajKod = (env, kod) => promeni(env, kod, (k) => (k.status === "zakljucan" ? { ...k, status: "aktivan", porudzbina: "" } : null), "Kod vraćen");
// Prihvaćena porudžbina: kod je potrošen
export const potrosiKod = (env, kod) => promeni(env, kod, (k) => (k.status === "iskoriscen" ? null : { ...k, status: "iskoriscen", iskoristen: new Date().toISOString() }), "Kod potrošen");

// Novi kod za kupca (posle prihvaćene porudžbine). vrsta: p10 | p20 | tocak
export async function napraviKod(env, vrsta, sett, napomena, email) {
  const cfg = cfgAt(env, KOD_DIR);
  if (!cfg) throw new Error("github nije podešen");
  const nastao = new Date().toISOString();
  for (let i = 0; i < 5; i++) {
    const kod = noviKod();
    const data = { kod, vrsta, status: "aktivan", nastao, rok_dana: sett.rok_dana, napomena: String(napomena || "").slice(0, 200), ishod: "", email: String(email || "").slice(0, 254), porudzbina: "" };
    const r = await gput(cfg, kod.toLowerCase() + ".json", toJson(data), undefined, `Novi kod: ${kod} [skip ci]`);
    if (conflict(r)) continue;   // ime već postoji (praktično nemoguće), pokušaj drugi kod
    if (!r.ok) throw new Error("github write " + r.status);
    return { kod, vrsta, rok: rokDatum(data) };
  }
  throw new Error("kod: nije uspelo");
}
export const vrstaZaPorudzbinu = (sett, ukupno) => (sett.tocak ? "tocak" : ukupno >= sett.prag ? "p20" : "p10");
export const vrstaOpis = (vrsta) => (vrsta === "tocak" ? "kod za točak" : (PRIZE[vrsta] ? opisNagrade(PRIZE[vrsta]) : ""));
