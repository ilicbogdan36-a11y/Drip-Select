// Netlify Function: čim stigne porudžbina, označi proizvode kao prodate (sold: true) u GitHub repozitorijumu.
// Env promenljive (Netlify > Site configuration > Environment variables):
//   GITHUB_TOKEN (fine-grained token, samo ovaj repo, Contents: Read and write), GH_OWNER, GH_REPO,
//   i opciono GH_BRANCH (default main) i GH_FOLDER (default content/proizvodi)
const FOLDER = process.env.GH_FOLDER || "content/proizvodi";
const BRANCH = process.env.GH_BRANCH || "main";

exports.handler = async (event) => {
  const { payload } = JSON.parse(event.body || "{}");
  if (!payload || payload.form_name !== "porudzbina") return { statusCode: 200, body: "preskoceno" };

  const files = String((payload.data || {}).fajlovi || "").split("|").map((s) => s.trim()).filter((s) => /^[^\/\\|]+\.md$/.test(s)); // dozvoljava i č/š/ž u imenu, ali ne i putanje (/ \)
  const api = `https://api.github.com/repos/${process.env.GH_OWNER}/${process.env.GH_REPO}/contents/${FOLDER}`;
  const headers = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "drip-select" };

  for (const f of files) {
    const r = await fetch(`${api}/${encodeURIComponent(f)}?ref=${BRANCH}`, { headers });
    if (!r.ok) { console.error("Ne mogu da procitam", f, r.status); continue; }
    const j = await r.json();
    let t = Buffer.from(j.content, "base64").toString("utf8");
    if (/^sold:\s*true\s*$/m.test(t)) continue;
    t = /^sold:.*$/m.test(t)
      ? t.replace(/^sold:.*$/m, "sold: true")
      : t.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, "$1\nsold: true$2");
    const u = await fetch(`${api}/${encodeURIComponent(f)}`, {
      method: "PUT", headers,
      body: JSON.stringify({ message: `Prodato: ${f}`, content: Buffer.from(t, "utf8").toString("base64"), sha: j.sha, branch: BRANCH }),
    });
    if (!u.ok) console.error("Ne mogu da upisem", f, u.status, await u.text());
  }
  return { statusCode: 200, body: "ok" };
};
