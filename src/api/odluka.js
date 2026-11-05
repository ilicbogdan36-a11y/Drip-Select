// Cloudflare Worker (src/worker.js): /api/odluka
// Stranica na koju vode dugmad Prihvati / Odbij iz mejla o porudžbini.
//   GET  ?t=<potpisan token>&a=prihvati|odbij  -> samo prikazuje stranicu sa dugmetom za potvrdu (ništa ne menja:
//                                                  programi za zaštitu pošte otvaraju linkove iz mejlova, pa klik na link sam ne sme da odluči)
//   POST (dugme na stranici)                   -> prihvati: proizvodi dobijaju sold: true i kupac dobija potvrdu;
//                                                 odbij: proizvodi ostaju u prodaji i kupac dobija obaveštenje
// Za jednu porudžbinu važi prva odluka (zapamćena najbolje što može: memorija Worker-a + Cache API).

import { readDecision } from "../decision.js";
import { ghCfg, readFile, readSold, reserve, sendMail, esc, sha, purge, REPLY_DEFAULT } from "./submit.js";

const INSTAGRAM = "dripselect.rs";   // za mejl kupcu; može da se promeni promenljivom IG_HANDLE
const HTML_H = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

// ---------- zapamćena odluka ----------
const mem = new Map();
const dKey = async (tok) => new Request("https://odluka.dripselect.internal/" + (await sha(tok)));
async function getDecided(tok) {
  const k = await sha(tok);
  if (mem.has(k)) return mem.get(k);
  try {
    if (typeof caches !== "undefined") {
      const got = await caches.default.match(await dKey(tok));
      if (got) { const o = await got.json(); if (o && o.a) { mem.set(k, o.a); return o.a; } }
    }
  } catch (e) { console.error("odluka get", e); }
  return null;
}
async function setDecided(tok, a) {
  mem.set(await sha(tok), a);
  try {
    if (typeof caches !== "undefined") await caches.default.put(await dKey(tok), new Response(JSON.stringify({ a }), { headers: { "cache-control": "max-age=1209600" } }));
  } catch (e) { console.error("odluka set", e); }
}

// ---------- stranica ----------
function page(title, inner, status = 200) {
  const html = `<!doctype html><html lang="sr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)} | Drip Select</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#07080c;color:#f4f6fa;font:16px/1.5 Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:20px}
.c{width:100%;max-width:520px;background:#0f121a;border:1px solid #1f2430;border-radius:16px;padding:28px 22px}.k{font:700 12px Arial,sans-serif;letter-spacing:3px;color:#6fb1ff;margin-bottom:10px}
h1{margin:0 0 10px;font-size:24px}p{margin:0 0 14px;color:#cbd5e6}.m{color:#8b93a7;font-size:14px}.it{background:#07080c;border:1px solid #1f2430;border-radius:10px;padding:12px 14px;margin:0 0 14px;white-space:pre-line;color:#f4f6fa}
.w{background:#2a1d08;border:1px solid #6b4a12;color:#ffd58a;border-radius:10px;padding:12px 14px;margin:0 0 14px;font-size:14px}.ok{background:#0b2414;border:1px solid #1d6b3a;color:#9be7b4;border-radius:10px;padding:12px 14px;margin:0 0 14px}
button,.b{display:block;width:100%;border:0;border-radius:10px;padding:14px;font:700 15px Arial,sans-serif;color:#fff;text-align:center;text-decoration:none;cursor:pointer}.g{background:#16a34a}.r{background:#dc2626}.l{background:none;color:#8b93a7;font-weight:400;font-size:14px;margin-top:8px;text-decoration:underline}</style></head>
<body><div class="c"><div class="k">DRIP SELECT</div>${inner}</div></body></html>`;
  return new Response(html, { status, headers: HTML_H });
}
const itemsBox = (d) => `<div class="it">${esc(d.a || "")}\n${esc(d.n || "")} · ${esc(d.e || "")}${d.u ? " · " + esc(d.u) : ""}</div>`;
const bad = () => page("Link nije važeći", `<h1>Link nije važeći</h1><p>Ovaj link je neispravan ili je izmenjen. Otvori dugme iz originalnog mejla o porudžbini.</p>`, 400);
const expired = () => page("Link je istekao", `<h1>Link je istekao</h1><p>Ova porudžbina je stara, pa se link više ne koristi. Ako komad još treba da se označi kao prodat, uradi to u adminu (Prodato).</p>`, 410);

// ---------- mejlovi kupcu ----------
function customerMail(kind, d, env) {
  const site = String(env.SITE_URL || "https://dripselect.rs").replace(/\/+$/, "");
  const contact = env.MAIL_REPLY || REPLY_DEFAULT;
  const ig = env.IG_HANDLE || INSTAGRAM;
  const hello = d.n ? `Zdravo, ${d.n}.` : "Zdravo.";
  const abroad = /^Unapred/i.test(d.p || "");
  let subject, title, paras;
  if (kind === "prihvati") {
    subject = "Porudžbina je potvrđena | Drip Select";
    title = "Porudžbina je potvrđena!";
    paras = [`${hello} Potvrdili smo tvoju porudžbinu, komad je tvoj.`,
      abroad ? "Javljamo ti se radi cene dostave i podataka za uplatu. Paket šaljemo kad uplata stigne." : "Javljamo se na telefon da dogovorimo dostavu. Plaćanje je pouzećem, gotovinom kuriru pri preuzimanju."];
  } else {
    subject = "O tvojoj porudžbini | Drip Select";
    title = "Nažalost, ne možemo da ispunimo porudžbinu";
    paras = [`${hello} Hvala na porudžbini. Nažalost, ovu porudžbinu ne možemo da ispunimo. Moguće je da je komad u međuvremenu prodat.`,
      `Ostale komade možeš da pogledaš na ${site.replace(/^https?:\/\//, "")}. Ako imaš pitanje, piši nam na Instagramu (@${ig}) ili na ${contact}.`];
  }
  const rows = [["Proizvodi", d.a], ["Ukupno", d.u]].filter(([, v]) => v);
  const trs = rows.map(([k, v]) => `<tr><td style="padding:7px 18px 7px 0;font:14px Arial,sans-serif;color:#8b93a7;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:7px 0;font:15px Arial,sans-serif;color:#f4f6fa">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("");
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#07080c" bgcolor="#07080c">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#07080c"><tr><td align="center" style="padding:28px 14px">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px" bgcolor="#0f121a"><tr><td style="padding:28px 20px 6px">` +
    `<div style="font:700 13px Arial,sans-serif;letter-spacing:3px;color:#6fb1ff">DRIP SELECT</div>` +
    `<h1 style="margin:10px 0 10px;font:700 24px Arial,sans-serif;color:#f4f6fa">${esc(title)}</h1>` +
    paras.map((p, i) => `<p style="margin:0 0 ${i === paras.length - 1 ? 22 : 8}px;font:15px/1.5 Arial,sans-serif;color:${i ? "#8b93a7" : "#cbd5e6"}">${esc(p)}</p>`).join("") +
    (trs ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px">${trs}</table>` : "") +
    `<p style="margin:0;padding:18px 0 26px;border-top:1px solid #1f2430;font:12px/1.6 Arial,sans-serif;color:#6b7387">Ovo je automatska poruka sa <a href="${esc(site)}" style="color:#8b93a7">dripselect.rs</a>. Pitanja: ${esc(contact)}.</p>` +
    `</td></tr></table></td></tr></table></body></html>`;
  const text = `${title}\n\n${paras.join("\n")}\n\n` + rows.map(([k, v]) => `${k}: ${v}`).join("\n") + `\n\nOvo je automatska poruka sa ${site}. Pitanja: ${contact}.`;
  return { subject, html, text };
}

// stanje komada: "free" | "sold" | "missing" (null ako GitHub nije dostupan)
async function stateOf(env, files) {
  const cfg = ghCfg(env);
  if (!cfg) return null;
  try {
    const out = [];
    for (const f of files) { const r = await readFile(cfg, f); out.push(r.missing ? "missing" : readSold(r.text) ? "sold" : "free"); }
    return out;
  } catch (e) { console.error("odluka stanje", e); return null; }
}

// ---------- GET: prikaz ----------
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const t = url.searchParams.get("t") || "", a = url.searchParams.get("a") === "odbij" ? "odbij" : "prihvati";
  const r = await readDecision(env, t);
  if (!r.ok) return r.reason === "expired" ? expired() : bad();
  const d = r.data;
  const done = await getDecided(t);
  if (done) return page("Već odlučeno", `<h1>Već odlučeno</h1><p>Za ovu porudžbinu je već ${done === "prihvati" ? "<b>prihvaćena</b>" : "<b>odbijena</b>"}.</p>${itemsBox(d)}`);
  const st = await stateOf(env, d.f);
  const soldNow = !!st && st.includes("sold"), gone = !!st && st.includes("missing");
  const other = `<a class="b l" href="?t=${encodeURIComponent(t)}&a=${a === "prihvati" ? "odbij" : "prihvati"}">${a === "prihvati" ? "Umesto toga odbij porudžbinu" : "Umesto toga prihvati porudžbinu"}</a>`;
  if (a === "prihvati") {
    if (soldNow || gone) {
      return page("Komad nije slobodan", `<h1>Komad nije slobodan</h1>${itemsBox(d)}<div class="w">${gone ? "Neki od komada više ne postoji na sajtu." : "Neki od komada je već označen kao prodat (druga porudžbina, ili si ovu već prihvatio)."} Ako je ovo druga porudžbina za isti komad, odbij je pa kupac dobija obaveštenje.</div>${other}`);
    }
    return page("Prihvati porudžbinu", `<h1>Prihvati porudžbinu?</h1>${itemsBox(d)}<p class="m">Proizvodi se označavaju kao prodati na sajtu, a kupac dobija mejl potvrde.</p><form method="post" action="/api/odluka"><input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="a" value="prihvati"><button class="g" type="submit">Prihvati porudžbinu</button></form>${other}`);
  }
  return page("Odbij porudžbinu", `<h1>Odbij porudžbinu?</h1>${itemsBox(d)}${soldNow ? `<div class="w">Pažnja: komad je već označen kao prodat. Ako si ovu porudžbinu već prihvatio, nemoj je odbijati, jer kupac dobija obaveštenje da je odbijena.</div>` : ""}<p class="m">Proizvodi ostaju u prodaji, a kupac dobija mejl da porudžbinu nismo mogli da ispunimo.</p><form method="post" action="/api/odluka"><input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="a" value="odbij"><button class="r" type="submit">Odbij porudžbinu</button></form>${other}`);
}

// ---------- POST: odluka ----------
export async function onRequestPost({ request, env, waitUntil }) {
  const origin = request.headers.get("origin");
  if (origin) { try { if (new URL(origin).host !== new URL(request.url).host) return page("Zabranjeno", "<h1>Zabranjeno</h1>", 403); } catch { return page("Zabranjeno", "<h1>Zabranjeno</h1>", 403); } }
  let t = "", a = "";
  try { const f = await request.formData(); t = String(f.get("t") || ""); a = String(f.get("a") || ""); } catch { return bad(); }
  if (a !== "prihvati" && a !== "odbij") return bad();
  const r = await readDecision(env, t);
  if (!r.ok) return r.reason === "expired" ? expired() : bad();
  const d = r.data;
  const done = await getDecided(t);
  if (done) return page("Već odlučeno", `<h1>Već odlučeno</h1><p>Za ovu porudžbinu je već ${done === "prihvati" ? "<b>prihvaćena</b>" : "<b>odbijena</b>"}. Ništa nije promenjeno.</p>${itemsBox(d)}`);

  const mailCustomer = async () => {
    if (!d.e) return false;
    try { await sendMail(env, customerMail(a, d, env), env.MAIL_REPLY || REPLY_DEFAULT, [], d.e); return true; }
    catch (e) { console.error("mejl kupcu (odluka)", e); return false; }
  };

  if (a === "prihvati") {
    const cfg = ghCfg(env);
    if (!cfg) return page("Greška", "<h1>Nije podešeno</h1><p>GitHub nije podešen na serveru.</p>", 500);
    let res;
    try { res = await reserve(cfg, d.f); }
    catch (e) { console.error("odluka prihvati", e); return page("Greška", `<h1>Nije uspelo</h1><p>Nismo uspeli da označimo proizvode kao prodate (GitHub nije odgovorio). Ništa nije promenjeno, pokušaj ponovo za koji minut.</p><a class="b g" href="?t=${encodeURIComponent(t)}&a=prihvati">Pokušaj ponovo</a>`, 502); }
    if (res.conflict) return page("Komad nije slobodan", `<h1>Komad nije slobodan</h1>${itemsBox(d)}<div class="w">Neki od komada je već označen kao prodat (druga porudžbina, ili si ovu već prihvatio). Ništa nije promenjeno.</div><a class="b l" href="?t=${encodeURIComponent(t)}&a=odbij">Odbij ovu porudžbinu</a>`, 409);
    if (res.done.length) purge(request, waitUntil);
    await setDecided(t, "prihvati");
    const sent = await mailCustomer();
    return page("Prihvaćeno", `<h1>Prihvaćeno</h1><div class="ok">Proizvodi su označeni kao prodati na sajtu.</div>${itemsBox(d)}<p>${sent ? "Kupac je dobio mejl potvrde." : "<b>Mejl kupcu nije poslat.</b> Javi mu se sam na telefon ili mejl."}</p>`);
  }

  const sent = await mailCustomer();
  if (!sent) return page("Mejl nije poslat", `<h1>Mejl kupcu nije poslat</h1><p>Porudžbina nije označena kao odbijena. Pokušaj ponovo, ili se javi kupcu sam (${esc(d.e || "bez mejla")}).</p><a class="b r" href="?t=${encodeURIComponent(t)}&a=odbij">Pokušaj ponovo</a>`, 502);
  await setDecided(t, "odbij");
  return page("Odbijeno", `<h1>Odbijeno</h1><div class="ok">Kupac je dobio mejl da porudžbinu nismo mogli da ispunimo.</div>${itemsBox(d)}<p class="m">Proizvodi su ostali u prodaji.</p>`);
}

export const onRequest = () => new Response("Method not allowed", { status: 405 });
