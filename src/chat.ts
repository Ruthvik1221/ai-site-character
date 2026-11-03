import { search } from "./knowledge.js";
import type { Site } from "./sites.js";

export interface LLM {
  complete(system: string, user: string): Promise<string>;
}

export interface Lead {
  siteId: string;
  email?: string;
  phone?: string;
  message: string;
  at: number;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

export type Reply = { text: string; source: "llm" | "knowledge_base" | "handoff"; leadCaptured: boolean };

/**
 * One chat turn:
 * 1. Capture contact details as a lead, then strip them before anything goes to the model.
 * 2. Retrieve the closest knowledge-base entries for this site.
 * 3. Ask the model to answer ONLY from those entries.
 * 4. If the model fails, times out, or there's nothing relevant, fall back to the best
 *    knowledge-base answer or a polite hand-off. The character never goes silent.
 */
export async function reply(site: Site, message: string, llm: LLM | null, saveLead: (l: Lead) => void, now = Date.now()): Promise<Reply> {
  const email = message.match(EMAIL)?.[0];
  const phone = message.match(PHONE)?.[0];
  const leadCaptured = Boolean(email || phone);
  if (leadCaptured) saveLead({ siteId: site.id, email, phone, message, at: now });
  const clean = message.replace(EMAIL, "[email]").replace(PHONE, "[phone]");

  const hits = search(site.knowledge, clean.replace(/\[(email|phone)\]/g, " "));
  const thanks = leadCaptured ? " Thanks, I've passed your details to the team and they'll reach out." : "";

  if (!hits.length || hits[0].score < 0.34) {
    return { text: `I'm not sure about that one.${thanks || " Leave your email or phone and someone from the team will follow up."}`, source: "handoff", leadCaptured };
  }

  if (llm) {
    const context = hits.map((h, i) => `[${i + 1}] Q: ${h.entry.q}\nA: ${h.entry.a}`).join("\n\n");
    const system = `You are the friendly website assistant for ${site.name}. Answer in 1-3 sentences using ONLY the facts below. If they don't cover the question, say you'll connect them with the team.\n\n${context}`;
    try {
      const text = await withTimeout(llm.complete(system, clean), 8000);
      if (text.trim()) return { text: text.trim() + thanks, source: "llm", leadCaptured };
    } catch {
      /* fall through to the knowledge base */
    }
  }
  return { text: hits[0].entry.a + thanks, source: "knowledge_base", leadCaptured };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}
