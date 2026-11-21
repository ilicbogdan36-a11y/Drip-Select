// Cloudflare Worker (src/worker.js): /api/kod
//   GET  -> javna podešavanja za sajt: { tocak, max_artikal, sanse: [{ id, naziv, p }] }   (p = šansa u procentima)
//   POST { a: "proveri" | "zavrti", kod } -> stanje koda, odnosno izvlačenje nagrade (samo ako je točak uključen u adminu)
// Nagradu bira SERVER (crypto.getRandomValues) i upisuje je u kod pre odgovora; sajt samo prikazuje animaciju.

import { hit, sha } from "./submit.js";
import { getSettings, nadjiKod, zavrtiKod, stanje, normKod, javnaNagrada, sanseFor, MAX_ARTIKAL } from "../codes.js";

const RL_WINDOW = 600, RL_MAX = 40;   // pokušaja po IP adresi u 10 min (sprečava pogađanje kodova)
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function onRequestGet({ env }) {
  const s = await getSettings(env);
  return json({ tocak: !!s.tocak, max_artikal: MAX_ARTIKAL, sanse: sanseFor(s).map(({ id, naziv, p }) => ({ id, naziv, p })) });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== new URL(request.url).host) return json({ error: "origin" }, 403); }
    catch { return json({ error: "origin" }, 403); }
  }
  if ((+request.headers.get("content-length") || 0) > 2000) return json({ error: "too_big" }, 413);
  let body;
  try { const t = await request.text(); if (t.length > 2000) return json({ error: "too_big" }, 413); body = JSON.parse(t); }
  catch { return json({ error: "bad_json" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "bad_json" }, 400);
  const a = body.a === "zavrti" ? "zavrti" : body.a === "proveri" ? "proveri" : "";
  if (!a) return json({ error: "akcija" }, 400);
  const kod = normKod(body.kod);
  if (!kod) return json({ ok: false, razlog: "nema" });

  const ip = request.headers.get("cf-connecting-ip");
  if (ip) {
    const n = await hit("k:" + (await sha(ip)), RL_WINDOW);
    if (n > (+env.RL_KOD > 0 ? +env.RL_KOD : RL_MAX)) return json({ error: "rate" }, 429);
  }

  try {
    const sett = await getSettings(env);
    if (a === "zavrti") {
      if (!sett.tocak) return json({ ok: false, razlog: "ugasen" });
      const r = await zavrtiKod(env, kod, sett);
      if (!r.ok) return json({ ok: false, razlog: r.razlog });
      return json({ ok: true, id: r.id, nagrada: r.nagrada || null, stanje: r.stanje, rok: r.rok || null, vec: !!r.vec });
    }
    const e = await nadjiKod(env, kod);
    if (!e) return json({ ok: false, razlog: "nema" });
    const st = stanje(e.data);
    if (st.s === "vazi") return json({ ok: true, stanje: "vazi", nagrada: javnaNagrada(st.prize), rok: st.rok || null, tocak: e.data.vrsta === "tocak" });
    if (st.s === "zavrti") return json({ ok: true, stanje: "zavrti", tocak: !!sett.tocak, rok: st.rok || null });
    return json({ ok: false, razlog: st.s });
  } catch (e) {
    console.error("kod", e);
    return json({ error: "github" }, 502);
  }
}

export const onRequest = () => json({ error: "method" }, 405);
