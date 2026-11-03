import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { z } from "zod";
import { reply, type LLM, type Lead } from "./chat.js";
import { RateLimiter } from "./rateLimit.js";
import type { SiteRegistry } from "./sites.js";

export interface Deps {
  sites: SiteRegistry;
  llm: LLM | null;
  leads: Lead[];
  adminToken: string;
  limiter?: RateLimiter;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(d: Deps) {
  const app = express();
  const limiter = d.limiter ?? new RateLimiter(10, 6);
  app.use(express.json({ limit: "8kb" }));
  app.use("/widget", express.static(path.join(here, "..", "public")));

  // CORS: reflect the Origin only if it's on this site's allowlist. Everything else is refused.
  const domainLock: express.RequestHandler = (req, res, next) => {
    const site = d.sites.get(String(req.params.siteId));
    if (!site) return void res.status(404).json({ error: "unknown site" });
    const origin = req.header("origin");
    if (!d.sites.originAllowed(site, origin)) return void res.status(403).json({ error: "this widget isn't enabled for this domain" });
    res.setHeader("Access-Control-Allow-Origin", origin!);
    res.setHeader("Vary", "Origin");
    res.locals.site = site;
    next();
  };

  app.options("/sites/:siteId/chat", domainLock, (_req, res) => {
    res.setHeader("Access-Control-Allow-Methods", "POST");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.sendStatus(204);
  });

  app.post("/sites/:siteId/chat", domainLock, async (req, res) => {
    const body = z.object({ message: z.string().min(1).max(1000) }).safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "message required (max 1000 chars)" });
    if (!limiter.take(`${req.params.siteId}|${req.ip}`)) return void res.status(429).json({ error: "slow down a little" });
    res.json(await reply(res.locals.site, body.data.message, d.llm, (l) => d.leads.push(l)));
  });

  // Agency: create a one-time pairing code for a site.
  app.post("/admin/sites/:siteId/pairing-code", (req, res) => {
    if (req.header("x-admin-token") !== d.adminToken) return void res.status(401).end();
    if (!d.sites.get(req.params.siteId)) return void res.status(404).end();
    res.json({ code: d.sites.createPairingCode(req.params.siteId), expiresInMinutes: 10 });
  });

  // Site plugin: redeem the code once and receive the site secret (shown once).
  app.post("/pair", (req, res) => {
    const code = z.object({ code: z.string().min(6).max(20) }).safeParse(req.body);
    const paired = code.success ? d.sites.redeemPairingCode(code.data.code) : null;
    if (!paired) return void res.status(400).json({ error: "code is invalid, expired or already used" });
    res.json(paired);
  });

  // Site plugin: replace its knowledge base, authenticated by the site secret.
  app.put("/sites/:siteId/knowledge", (req, res) => {
    const site = d.sites.get(req.params.siteId);
    const secret = (req.header("authorization") ?? "").replace(/^Bearer /, "");
    if (!site || !d.sites.verifySecret(site, secret)) return void res.status(401).json({ error: "unauthorized" });
    const kb = z.array(z.object({ q: z.string().min(3).max(300), a: z.string().min(1).max(1500) })).max(500).safeParse(req.body);
    if (!kb.success) return void res.status(400).json({ error: kb.error.flatten() });
    site.knowledge = kb.data;
    res.json({ entries: kb.data.length });
  });

  return app;
}
