// ─────────────────────────────────────────────
// Deterministic cleanup after the rewrite — safety net only.
//
// Replaces the legacy word-swap / noise-injection steps, which broke grammar
// ("communication drive understanding") and pushed human text toward AI scores.
// Rules here are limited to changes that are safe without understanding the
// sentence:
//   1. Remove definite chatbot leftovers: citation artifacts, "I hope this
//      helps", markdown bold/headings
//   2. Swap a few AI phrases for plain ones, with every inflection spelled out
//      and capitalisation kept
//   3. Thin out spaced em dashes (Claude's habit)
// It never adds hedges, asides, filler, or mistakes.
// ─────────────────────────────────────────────

// ── 1. Chatbot leftovers
const ARTIFACT_RES = [
  /:contentReference\[oaicite:\d+\]\{index=\d+\}/g,
  /\[?oai_citation[^\]\s]*\]?/g,
  /?cite?turn\d+\w+\d+?/g,
  /\bturn\d+(search|image|news|file)\d+\b/g,
  /\s?\[cite:\s*[\d,\s]+\]/g,
  /\s?【\d+†[^】]*】/g,
  /\s?\[(attached_file|web):\d+\]/g,
  /\[span_\d+\]\((start|end)_span\)/g,
  /\(\{"attribution":\{"attributableIndex":"[\d-]+"\}\}\)/g,
  /[?&]utm_source=(chatgpt\.com|openai|copilot\.com)/g,
];

// Whole sentences addressed to the chatbot user
const CHAT_SENTENCE_RE = /(^|(?<=[.!?]\s))\s*(certainly!|of course!|absolutely!|great question[.!]?|i hope this helps[.!]?|let me know if [^.!?]*[.!?]|would you like (me )?to [^.!?]*\?|feel free to [^.!?]*[.!?]|is there anything else[^.!?]*\?|here(?: is|'s) (?:a|an|the) (?:revised|rewritten|updated|humani[sz]ed)[^:.!?]*[:.])\s*/gi;

function stripLeftovers(text) {
  let out = text;
  for (const re of ARTIFACT_RES) out = out.replace(re, "");
  out = out.replace(CHAT_SENTENCE_RE, "$1");
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "$1");            // **bold**
  out = out.replace(/^#{1,6}\s+/gm, "");                     // # headings
  out = out.replace(/\s*\p{Extended_Pictographic}️?/gu, "");
  return out;
}

// ── 2. Phrase swaps. Each entry: [regex, replacement]. Replacements keep the
// grammar of the original form, so no context is needed.
const SWAPS = [
  [/\butili[sz]e\b/gi, "use"],
  [/\butili[sz]es\b/gi, "uses"],
  [/\butili[sz]ed\b/gi, "used"],
  [/\butili[sz]ing\b/gi, "using"],
  [/\butili[sz]ation\b/gi, "use"],
  [/\bdelve into\b/gi, "dig into"],
  [/\bdelves into\b/gi, "digs into"],
  [/\bdelved into\b/gi, "dug into"],
  [/\bdelving into\b/gi, "digging into"],
  [/\b(serves|stands) as a testament to\b/gi, "shows"],
  [/\b(served|stood) as a testament to\b/gi, "showed"],
  [/\bis a testament to\b/gi, "shows"],
  [/\bwas a testament to\b/gi, "showed"],
  [/\bin today's (fast-paced |digital |modern |interconnected )?(world|age|society)\b/gi, "today"],
];

// Openers that are deleted outright; the next word is capitalised when the
// opener started a sentence.
const DELETIONS = [
  /(?:it is|it's) (?:important|worth|crucial) (?:to note|noting) that\s+/,
  /it should be noted that\s+/,
  /in conclusion,\s+/,
  /in summary,\s+/,
].map(re => ({
  atStart: new RegExp(`(^|[.!?]["”’)]?\\s+)(?:${re.source})(\\p{L})`, "giu"),
  anywhere: new RegExp(re.source, "gi"),
}));

function matchCase(source, replacement) {
  if (!replacement) return replacement;
  if (source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function applySwaps(text) {
  let out = text;
  for (const [re, rep] of SWAPS) {
    out = out.replace(re, m => matchCase(m, rep));
  }
  for (const { atStart, anywhere } of DELETIONS) {
    out = out.replace(atStart, (m, before, next) => before + next.toUpperCase());
    out = out.replace(anywhere, "");
  }
  return out;
}

// ── 3. Spaced em dashes. Keep at most one per ~150 words; turn the rest into
// commas (a dash pair "A — B — C" becomes "A, B, C").
function thinDashes(text) {
  const words = (text.match(/\S+/g) || []).length;
  let budget = Math.max(1, Math.floor(words / 150));
  return text.split(/(?<=[.!?])\s+/).map(sentence => {
    const dashes = (sentence.match(/\s[—–]\s/g) || []).length;
    if (!dashes) return sentence;
    if (budget > 0 && dashes === 1) { budget--; return sentence; }
    return sentence.replace(/\s[—–]\s/g, ", ");
  }).join(" ");
}

function tidy(text) {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Paragraph-safe: works on each paragraph so line breaks survive.
function cleanup(text) {
  const stripped = stripLeftovers(text);
  return tidy(
    stripped.split(/\n\s*\n/).map(p => thinDashes(applySwaps(p.trim()))).filter(Boolean).join("\n\n")
  );
}

module.exports = { cleanup, stripLeftovers, applySwaps, thinDashes };
