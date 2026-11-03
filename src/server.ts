import { createApp } from "./app.js";
import type { LLM } from "./chat.js";
import { SiteRegistry } from "./sites.js";

// Any OpenAI-compatible endpoint works. With no key, the character answers from the knowledge base alone.
const llm: LLM | null = process.env.LLM_API_KEY
  ? {
      async complete(system, user) {
        const res = await fetch(`${process.env.LLM_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${process.env.LLM_API_KEY}` },
          body: JSON.stringify({
            model: process.env.LLM_MODEL ?? "gpt-4o-mini",
            temperature: 0.2,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
        if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        return data.choices?.[0]?.message?.content ?? "";
      },
    }
  : null;

const sites = new SiteRegistry();
sites.add({
  id: "demo",
  name: "Demo Plumbing Co.",
  allowedOrigins: ["http://localhost:3000", "http://localhost:5173"],
  knowledge: [
    { q: "What are your hours?", a: "We're open Monday to Friday, 8am to 6pm, with 24/7 emergency service." },
    { q: "Do you offer free estimates?", a: "Yes, estimates are free for any job over $200." },
    { q: "What areas do you serve?", a: "We serve the whole county and neighboring towns within 30 miles." },
  ],
});

const port = Number(process.env.PORT ?? 3000);
createApp({ sites, llm, leads: [], adminToken: process.env.ADMIN_TOKEN ?? "change-me" }).listen(port, () =>
  console.log(`listening on http://localhost:${port}  (open /widget/demo.html)`),
);
