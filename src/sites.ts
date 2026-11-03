import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface KbEntry {
  q: string;
  a: string;
}

export interface Site {
  id: string;
  name: string;
  /** Exact origins allowed to load the widget, e.g. "https://www.example.com". */
  allowedOrigins: string[];
  knowledge: KbEntry[];
  /** sha256 of the site secret. The secret itself is shown once at pairing and never stored. */
  secretHash?: string;
}

interface PairingCode {
  siteId: string;
  codeHash: string;
  expiresAt: number;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Site registry with one-time pairing.
 *
 * 1. The agency creates a pairing code (short, human-typeable, 10-minute expiry).
 * 2. The site owner enters it in the plugin; the plugin redeems it once and receives a long site secret.
 * 3. The plugin authenticates admin calls (e.g. knowledge-base updates) with that secret; the server stores only its hash.
 */
export class SiteRegistry {
  private sites = new Map<string, Site>();
  private codes: PairingCode[] = [];

  constructor(private now: () => number = Date.now) {}

  add(site: Site) {
    this.sites.set(site.id, site);
  }

  get(id: string) {
    return this.sites.get(id);
  }

  /** Browsers send the Origin header on cross-site requests. Non-browser callers can fake it, so this is paired with rate limits. */
  originAllowed(site: Site, origin: string | undefined) {
    return !!origin && site.allowedOrigins.includes(origin.replace(/\/$/, ""));
  }

  createPairingCode(siteId: string, ttlMs = 10 * 60_000) {
    if (!this.sites.has(siteId)) throw new Error("unknown site");
    const code = randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
    this.codes.push({ siteId, codeHash: sha(code), expiresAt: this.now() + ttlMs });
    return code;
  }

  /** Single use: a code is removed as soon as it is redeemed. Returns the site secret once. */
  redeemPairingCode(code: string): { siteId: string; secret: string } | null {
    const t = this.now();
    this.codes = this.codes.filter((c) => c.expiresAt > t);
    const i = this.codes.findIndex((c) => c.codeHash === sha(code.trim().toUpperCase()));
    if (i < 0) return null;
    const [entry] = this.codes.splice(i, 1);
    const site = this.sites.get(entry.siteId)!;
    const secret = randomBytes(32).toString("base64url");
    site.secretHash = sha(secret);
    return { siteId: site.id, secret };
  }

  /** Admin calls send the site secret as a bearer token over TLS; only its hash is stored, compared in constant time. */
  verifySecret(site: Site, secret: string | undefined): boolean {
    if (!site.secretHash || !secret) return false;
    const a = Buffer.from(site.secretHash, "hex");
    const b = Buffer.from(sha(secret), "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
