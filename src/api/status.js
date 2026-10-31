// GET /api/status: pomoć pri podešavanju. Pokazuje samo da li je svaka promenljiva podešena i izgleda li ispravno,
// nikad same vrednosti. Može da se obriše kad sve proradi.
const BUILD = "2026-10-31-b";

const CHECKS = {
  GITHUB_TOKEN: (v) => /^(github_pat_|ghp_)[A-Za-z0-9_]+$/.test(v),
  RESEND_API_KEY: (v) => /^re_[A-Za-z0-9_]+$/.test(v),
  MAIL_TO: (v) => v.split(",").every((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.trim())),
  GITHUB_CLIENT_ID: (v) => /^[A-Za-z0-9._]{18,24}$/.test(v),
  GITHUB_CLIENT_SECRET: (v) => /^[a-f0-9]{40}$/.test(v),
  GH_OWNER: (v) => /^[A-Za-z0-9-]+$/.test(v),
  GH_REPO: (v) => /^[A-Za-z0-9._-]+$/.test(v),
  ALLOWED_USERS: (v) => v.length > 0,
};

export async function onRequestGet({ env }) {
  const out = { build: BUILD };
  for (const [name, ok] of Object.entries(CHECKS)) {
    const v = env[name];
    if (typeof v !== "string" || v === "") out[name] = "NEDOSTAJE";
    else if (v !== v.trim()) out[name] = "ima razmak ili novi red na početku/kraju (izbriši ga)";
    else out[name] = ok(v) ? "ok" : "podešeno, ali ne izgleda kao prava vrednost (pogrešno nalepljeno?)";
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
