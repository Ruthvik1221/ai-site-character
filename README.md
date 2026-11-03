# ai-site-character

An embeddable AI "website character": one `<script>` tag puts a friendly assistant on any site (WordPress, Wix, Squarespace, plain HTML). It answers from that business's own knowledge base, captures leads, and never goes silent when the model is down.

> Clean-room reference implementation written from scratch to show the pattern. It contains no employer or client code, prompts or data. I've built and run a production character like this at work; this repo shows the architecture.

```html
<script src="https://YOUR-HOST/widget/widget.js" data-site="SITE_ID" data-name="Max" async></script>
```

## Background

I designed and built the production version of this at New Paltz Marketing: **Max**, an animated, speaking AI website assistant, later productized as **MascotDesk**, a white-label platform deployed across client sites. That code belongs to my employer, so this repository is a clean-room rewrite, written from scratch, to show the same architecture and decisions publicly. No employer or client code, prompts or data are included.

## How it works

```
visitor ─► widget.js (Shadow DOM) ─► POST /sites/:id/chat
                                       │ domain lock (Origin allowlist + CORS)
                                       │ rate limit (token bucket per site+visitor)
                                       ▼
                            capture lead (email/phone) ─► strip contact details
                                       ▼
                            retrieve top KB entries (IDF keyword search)
                                       ▼
                 score too low? ─► polite hand-off ("leave your email…")
                                       ▼
                 LLM answers ONLY from retrieved facts (8s timeout)
                                       ▼
                 model error/timeout ─► best KB answer
```

## Design decisions

| Concern | Approach |
| --- | --- |
| Someone copies the embed code onto their own site | **Domain lock**: each site has an exact-origin allowlist; CORS is reflected only for those origins. (Non-browser clients can fake `Origin`, so this is paired with rate limits.) |
| Connecting a customer's site without sharing passwords | **One-time pairing**: the agency issues a 10-minute code; the site plugin redeems it once and receives a long secret. Only a **hash** of the secret is stored, compared in constant time. |
| Hallucinated answers | The model sees only the retrieved entries and is told to answer from them; below a relevance threshold it **hands off** instead of calling the model. |
| Model outage or slowness | 8-second timeout, then the best knowledge-base answer. Works with no model configured at all. |
| Privacy | Emails and phone numbers are saved as a lead, then **removed before the text reaches the model**. |
| Host CSS breaking the widget | Rendered inside a **Shadow DOM**; respects `prefers-reduced-motion`; dialog and live-region ARIA roles. |
| Bot traffic / cost | Token-bucket rate limit per site and visitor. |

Retrieval is a small dependency-free IDF keyword search on purpose; the `search()` interface can be swapped for embeddings without touching the chat flow.

## Tests

```bash
npm install
npm test        # 15 tests, no network
npm run typecheck
```

Covers retrieval, model-backed answers, model failure fallback, no-model mode, hand-off, lead capture with redaction, single-use and expiring pairing codes, hashed secrets, exact-origin matching (including look-alike domains), rate limiting, and the HTTP flow end to end.

## Run it

```bash
npm run dev                          # knowledge-base only
LLM_API_KEY=... npm run dev          # with any OpenAI-compatible model
open http://localhost:3000/widget/demo.html
```

## License

MIT
