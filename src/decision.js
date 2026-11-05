// Potpisan link za odluku o porudžbini (Prihvati / Odbij u mejlu vlasniku).
// Link nosi sve što treba (komadi, kupac, vreme) i potpis (HMAC-SHA256), pa ne treba prijava ni baza podataka.
// Ključ je DECISION_SECRET ako je podešen, a inače se izvodi iz GITHUB_TOKEN-a (koji ionako postoji i nikad ne napušta server).
// Potpis se ne može lažirati bez ključa; ko ima link iz mejla može da odluči o toj jednoj porudžbini, zato važi ograničeno vreme.

export const DECISION_DAYS = 14;

const enc = new TextEncoder();
const toB64u = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const fromB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (String(s).length % 4)) % 4)), (c) => c.charCodeAt(0));

async function key(env) {
  const secret = env.DECISION_SECRET || env.GITHUB_TOKEN;
  if (!secret) return null;
  return crypto.subtle.importKey("raw", enc.encode("drip-select-odluka:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

// payload: { f: [fajlovi], e: mejl, n: ime, a: proizvodi, u: ukupno, p: plaćanje }
export async function signDecision(env, payload) {
  const k = await key(env);
  if (!k) throw new Error("nema ključa za potpis");
  const body = toB64u(enc.encode(JSON.stringify({ ...payload, t: Date.now() })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(body)));
  return body + "." + toB64u(sig);
}

// Vraća { ok: true, data } ili { ok: false, reason: "bad" | "expired" }
export async function readDecision(env, token) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig || String(token).length > 6000) return { ok: false, reason: "bad" };
    const k = await key(env);
    if (!k) return { ok: false, reason: "bad" };
    if (!(await crypto.subtle.verify("HMAC", k, fromB64u(sig), enc.encode(body)))) return { ok: false, reason: "bad" };
    const data = JSON.parse(new TextDecoder().decode(fromB64u(body)));
    if (!data || !Array.isArray(data.f) || !data.f.length || typeof data.t !== "number") return { ok: false, reason: "bad" };
    if (Date.now() - data.t > DECISION_DAYS * 86400000) return { ok: false, reason: "expired" };
    return { ok: true, data };
  } catch { return { ok: false, reason: "bad" }; }
}
