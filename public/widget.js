/*
 * Embeddable site character. One script tag:
 *   <script src="https://YOUR-HOST/widget/widget.js" data-site="SITE_ID" data-name="Max" async></script>
 * No framework, no build step, ~4 KB. Renders inside a Shadow DOM so the host site's CSS can't break it.
 */
(function () {
  const me = document.currentScript;
  const siteId = me && me.dataset.site;
  if (!siteId) return console.warn("[site-character] missing data-site");
  const api = new URL(me.src).origin;
  const name = (me.dataset.name || "Max").replace(/[<>&"']/g, ""); // used in markup below, so strip HTML characters

  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .btn { position: fixed; right: 20px; bottom: 20px; width: 64px; height: 64px; border-radius: 50%; border: 0;
             background: #1f6feb; color: #fff; font: 600 28px system-ui; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.25);
             animation: bob 3s ease-in-out infinite; }
      @keyframes bob { 50% { transform: translateY(-6px); } }
      @media (prefers-reduced-motion: reduce) { .btn { animation: none; } }
      .panel { position: fixed; right: 20px; bottom: 96px; width: min(340px, calc(100vw - 40px)); max-height: 60vh; display: none;
               flex-direction: column; background: #fff; border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.25); font: 14px/1.4 system-ui; }
      .panel.open { display: flex; }
      .log { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
      .m { padding: 8px 10px; border-radius: 10px; max-width: 85%; white-space: pre-wrap; }
      .bot { background: #f1f3f5; align-self: flex-start; } .you { background: #1f6feb; color: #fff; align-self: flex-end; }
      form { display: flex; border-top: 1px solid #e5e7eb; } input { flex: 1; border: 0; padding: 12px; font: inherit; outline: none; }
      button.send { border: 0; background: none; padding: 0 14px; color: #1f6feb; font-weight: 600; cursor: pointer; }
    </style>
    <div class="panel" role="dialog" aria-label="Chat with ${name}"><div class="log" aria-live="polite"></div>
      <form><input aria-label="Message" placeholder="Ask ${name} anything…" maxlength="1000"><button class="send">Send</button></form></div>
    <button class="btn" aria-label="Open chat with ${name}">👋</button>`;
  document.body.appendChild(host);

  const panel = root.querySelector(".panel"), log = root.querySelector(".log"), input = root.querySelector("input");
  const say = (text, who) => { const d = document.createElement("div"); d.className = "m " + who; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; };

  root.querySelector(".btn").addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open") && !log.children.length) say(`Hi, I'm ${name}! How can I help?`, "bot");
    input.focus();
  });

  root.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    say(text, "you");
    try {
      const res = await fetch(`${api}/sites/${encodeURIComponent(siteId)}/chat`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      say(res.ok ? data.text : data.error || "Something went wrong.", "bot");
    } catch {
      say("I can't connect right now. Please try again in a moment.", "bot");
    }
  });
})();
