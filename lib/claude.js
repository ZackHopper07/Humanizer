// ─────────────────────────────────────────────
// Claude client (Anthropic SDK)
//
// One place for the model and request settings. The legacy pipeline keeps its
// own raw-fetch call to claude-sonnet-4-6 so its baseline stays reproducible.
// ─────────────────────────────────────────────
const Anthropic = require("@anthropic-ai/sdk");

// Override with CLAUDE_MODEL in .env (e.g. claude-sonnet-5-5 costs half as much)
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

// Models that accept the server-side refusal fallback ("default" routing)
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

const clients = new Map();
function clientFor(apiKey) {
  if (!clients.has(apiKey)) clients.set(apiKey, new Anthropic({ apiKey }));
  return clients.get(apiKey);
}

// Single-turn completion. Current models don't accept temperature; thinking
// depth is set with effort instead.
async function complete({ apiKey, system, user, effort = "medium", maxTokens = 16000 }) {
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort },
    system,
    messages: [{ role: "user", content: user }],
  };
  if (FALLBACK_MODELS.has(MODEL)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }

  const response = await clientFor(apiKey).beta.messages.create(params);

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to rewrite this text.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The rewrite was cut off before it finished. Try a shorter text.");
  }
  return response.content
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("")
    .trim();
}

module.exports = { complete, MODEL };
