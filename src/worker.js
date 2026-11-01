// Cloudflare Worker: usmerava /api/* na funkcije; sve ostalo (sajt, /admin, slike) servira Cloudflare iz foldera public/.
import * as submit from "./api/submit.js";
import * as products from "./api/products.js";
import * as auth from "./api/auth.js";
import * as callback from "./api/callback.js";
import * as status from "./api/status.js";
import { productPage, ogImage } from "./page.js";
import { checkDrop } from "./drop.js";

const ROUTES = { "/api/submit": submit, "/api/products": products, "/api/auth": auth, "/api/callback": callback, "/api/status": status };
const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Decap config: __ORIGIN__ se menja adresom na kojoj je sajt otvoren (workers.dev ili tvoj domen), pa nema ručnog upisivanja
    if (url.pathname === "/admin/config.yml") {
      const r = await env.ASSETS.fetch(request);
      if (!r.ok) return r;
      const text = (await r.text()).replaceAll("__ORIGIN__", url.origin);
      return new Response(text, { headers: { "content-type": "text/yaml; charset=utf-8", "cache-control": "no-store" } });
    }

    // Čist link proizvoda i slika za pregled linka (Viber, WhatsApp, Facebook...)
    if (url.pathname.startsWith("/proizvod/") || url.pathname.startsWith("/og-img/")) {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method" }, 405);
      const h = url.pathname.startsWith("/proizvod/") ? productPage : ogImage;
      const waitUntil = (p) => ctx.waitUntil(p);
      try { return await h({ request, env, waitUntil }); }
      catch (e) { console.error("page", e); return env.ASSETS.fetch(new Request(url.origin + "/")); } // nikad prazna stranica: u najgorem slučaju običan sajt
    }

    const mod = ROUTES[url.pathname];
    if (!mod) return json({ error: "not_found" }, 404);
    const m = request.method;
    const handler = mod["onRequest" + m[0] + m.slice(1).toLowerCase()] || mod.onRequest;
    if (!handler) return json({ error: "method" }, 405);
    return handler({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
  },

  // Cron Trigger (wrangler.jsonc): javlja pretplatnicima kad izađu novi proizvodi (src/drop.js)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkDrop(env).then((r) => console.log("drop", JSON.stringify(r)), (e) => console.error("drop", e)));
  },
};
