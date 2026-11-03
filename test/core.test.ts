import { describe, expect, it } from "vitest";
import { reply, type LLM, type Lead } from "../src/chat.js";
import { search } from "../src/knowledge.js";
import { RateLimiter } from "../src/rateLimit.js";
import { SiteRegistry, type Site } from "../src/sites.js";

const site = (): Site => ({
  id: "s1",
  name: "Demo Plumbing",
  allowedOrigins: ["https://www.demo.example"],
  knowledge: [
    { q: "What are your hours?", a: "Mon-Fri 8am-6pm, 24/7 emergencies." },
    { q: "Do you offer free estimates?", a: "Yes, free estimates for jobs over $200." },
    { q: "Which areas do you serve?", a: "The whole county, within 30 miles." },
  ],
});

class MockLLM implements LLM {
  seen: { system: string; user: string }[] = [];
  constructor(private out: string | Error) {}
  async complete(system: string, user: string) {
    this.seen.push({ system, user });
    if (this.out instanceof Error) throw this.out;
    return this.out;
  }
}

describe("knowledge search", () => {
  it("finds the right entry despite wording and plurals", () => {
    expect(search(site().knowledge, "are estimates free?")[0].entry.q).toMatch(/estimates/);
    expect(search(site().knowledge, "what hours are you open")[0].entry.q).toMatch(/hours/);
  });
  it("returns nothing for unrelated questions", () => {
    expect(search(site().knowledge, "tell me a joke about penguins")).toEqual([]);
  });
});

describe("chat turn", () => {
  it("answers through the model using only retrieved facts", async () => {
    const llm = new MockLLM("We're open 8 to 6 on weekdays.");
    const r = await reply(site(), "When are you open? what hours", llm, () => {});
    expect(r).toMatchObject({ source: "llm", leadCaptured: false });
    expect(llm.seen[0].system).toMatch(/ONLY the facts below/);
    expect(llm.seen[0].system).toMatch(/Mon-Fri/);
  });

  it("falls back to the knowledge base when the model fails", async () => {
    const r = await reply(site(), "do you offer free estimates", new MockLLM(new Error("503")), () => {});
    expect(r).toEqual({ text: "Yes, free estimates for jobs over $200.", source: "knowledge_base", leadCaptured: false });
  });

  it("works with no model configured at all", async () => {
    expect((await reply(site(), "which areas do you serve", null, () => {})).source).toBe("knowledge_base");
  });

  it("hands off instead of inventing an answer", async () => {
    const llm = new MockLLM("should not be called");
    const r = await reply(site(), "can you fix my car", llm, () => {});
    expect(r.source).toBe("handoff");
    expect(llm.seen).toHaveLength(0);
  });

  it("captures leads and never sends contact details to the model", async () => {
    const leads: Lead[] = [];
    const llm = new MockLLM("Yes, they're free over $200.");
    const r = await reply(site(), "free estimates? I'm at sam@home.example or 845-555-0199", llm, (l) => leads.push(l), 1);
    expect(leads).toEqual([{ siteId: "s1", email: "sam@home.example", phone: "845-555-0199", message: expect.any(String), at: 1 }]);
    expect(llm.seen[0].user).not.toMatch(/sam@|555-0199/);
    expect(r.text).toMatch(/passed your details/);
  });
});

describe("site pairing", () => {
  it("is single-use, expires, and stores only a hash of the secret", () => {
    let now = 0;
    const reg = new SiteRegistry(() => now);
    reg.add(site());
    const code = reg.createPairingCode("s1");
    const paired = reg.redeemPairingCode(code.toLowerCase())!; // case-insensitive for humans
    expect(paired.siteId).toBe("s1");
    expect(reg.redeemPairingCode(code)).toBeNull();
    expect(reg.get("s1")!.secretHash).not.toContain(paired.secret);
    expect(reg.verifySecret(reg.get("s1")!, paired.secret)).toBe(true);
    expect(reg.verifySecret(reg.get("s1")!, "wrong")).toBe(false);

    const late = reg.createPairingCode("s1");
    now += 11 * 60_000;
    expect(reg.redeemPairingCode(late)).toBeNull();
  });

  it("locks the widget to exact origins", () => {
    const reg = new SiteRegistry();
    const s = site();
    expect(reg.originAllowed(s, "https://www.demo.example")).toBe(true);
    expect(reg.originAllowed(s, "https://www.demo.example/")).toBe(true);
    expect(reg.originAllowed(s, "https://evil.example")).toBe(false);
    expect(reg.originAllowed(s, "https://www.demo.example.evil.example")).toBe(false);
    expect(reg.originAllowed(s, undefined)).toBe(false);
  });
});

describe("rate limiter", () => {
  it("allows a burst, blocks, then refills over time", () => {
    let now = 0;
    const rl = new RateLimiter(3, 6, () => now);
    expect([rl.take("k"), rl.take("k"), rl.take("k"), rl.take("k")]).toEqual([true, true, true, false]);
    now += 10_000; // 6/min -> 1 token per 10s
    expect(rl.take("k")).toBe(true);
    expect(rl.take("other")).toBe(true);
  });
});
