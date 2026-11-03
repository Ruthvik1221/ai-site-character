import type { KbEntry } from "./sites.js";

const STOP = new Set("a am an and are at be can do does for from hello hey hi how i im in is it me my of on or please reach that the this to we what when where who why with you your".split(" "));

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/, "")); // tiny stemmer: "prices" ~ "price"
}

export interface Hit {
  entry: KbEntry;
  score: number;
}

/**
 * Keyword retrieval with IDF weighting: rare words count more than common ones.
 * Deliberately simple and dependency-free; the interface is what matters, and it can be
 * swapped for embeddings without touching the chat flow.
 */
export function search(kb: KbEntry[], query: string, k = 3): Hit[] {
  const docs = kb.map((e) => new Set(tokens(`${e.q} ${e.a}`)));
  const qTokens = [...new Set(tokens(query))];
  if (!qTokens.length) return [];
  const idf = (t: string) => Math.log(1 + kb.length / (1 + docs.filter((d) => d.has(t)).length));
  const max = qTokens.reduce((s, t) => s + idf(t), 0);
  return kb
    .map((entry, i) => ({ entry, score: qTokens.reduce((s, t) => s + (docs[i].has(t) ? idf(t) : 0), 0) / max }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
