import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Lead } from "../src/chat.js";
import { RateLimiter } from "../src/rateLimit.js";
import { SiteRegistry } from "../src/sites.js";

const ORIGIN = "https://www.demo.example";

function setup(limiter?: RateLimiter) {
  const sites = new SiteRegistry();
  sites.add({ id: "s1", name: "Demo", allowedOrigins: [ORIGIN], knowledge: [{ q: "What are your hours?", a: "9 to 5." }] });
  const leads: Lead[] = [];
  return { app: createApp({ sites, llm: null, leads, adminToken: "admin", limiter }), leads };
}

describe("HTTP API", () => {
  it("answers from an allowed origin and sets CORS for that origin only", async () => {
    const res = await request(setup().app).post("/sites/s1/chat").set("origin", ORIGIN).send({ message: "your hours?" }).expect(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(res.body.text).toBe("9 to 5.");
  });

  it("refuses other domains and unknown sites", async () => {
    const { app } = setup();
    await request(app).post("/sites/s1/chat").set("origin", "https://copycat.example").send({ message: "hi" }).expect(403);
    await request(app).post("/sites/nope/chat").set("origin", ORIGIN).send({ message: "hi" }).expect(404);
  });

  it("rate limits per site and visitor", async () => {
    const { app } = setup(new RateLimiter(1, 0.0001));
    await request(app).post("/sites/s1/chat").set("origin", ORIGIN).send({ message: "hours" }).expect(200);
    await request(app).post("/sites/s1/chat").set("origin", ORIGIN).send({ message: "hours" }).expect(429);
  });

  it("pairs a site once, then lets it update its knowledge base with the secret", async () => {
    const { app } = setup();
    await request(app).post("/admin/sites/s1/pairing-code").expect(401);
    const { body } = await request(app).post("/admin/sites/s1/pairing-code").set("x-admin-token", "admin").expect(200);
    const paired = await request(app).post("/pair").send({ code: body.code }).expect(200);
    await request(app).post("/pair").send({ code: body.code }).expect(400);

    const kb = [{ q: "Do you do weekends?", a: "Saturdays only." }];
    await request(app).put("/sites/s1/knowledge").set("authorization", "Bearer wrong").send(kb).expect(401);
    await request(app).put("/sites/s1/knowledge").set("authorization", `Bearer ${paired.body.secret}`).send(kb).expect(200);
    const res = await request(app).post("/sites/s1/chat").set("origin", ORIGIN).send({ message: "weekends?" }).expect(200);
    expect(res.body.text).toBe("Saturdays only.");
  });

  it("serves the embeddable widget", async () => {
    const res = await request(setup().app).get("/widget/widget.js").expect(200);
    expect(res.text).toMatch(/attachShadow/);
  });
});
