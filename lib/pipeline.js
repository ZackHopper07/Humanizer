// ─────────────────────────────────────────────
// Humanize pipeline
//
//   lock facts → rewrite → cleanup → detector check → up to 2 targeted fixes
//   → repair any lost facts
//
// Changes from lib/legacy-pipeline.js, each backed by the eval:
//   - No regex noise injection or word-swap list: they broke grammar and raised
//     detector scores on human text (academic sample 0% → 39%)
//   - No "make it rougher" pass or polish pass
//   - Prompt no longer forces 2 paragraphs, a 20-word cap, constant
//     contractions, em dashes, or a ban on conclusions
//   - Local detector replaces Claude self-scoring and drives the fix passes
//   - Citations, numbers and quotations are checked after every rewrite
//   - Long example lists may be trimmed to the 1–2 most relevant (option B)
// Typically 1–3 Claude calls instead of 5–6.
// ─────────────────────────────────────────────
const { complete } = require("./claude");
const { cleanup } = require("./cleanup");
const { detect } = require("./detector");
const { extractFacts, missingFacts, describeFacts } = require("./facts");

const MAX_FIX_PASSES = 2;
// Fix while the text would still be highlighted by Turnitin (20%+) or reads
// as more likely AI than not
const needsFix = report => report.aiPercent >= 20 || report.likelihood >= 40;

const TONES = {
  casual: `Someone smart explaining this to a friend. Direct and relaxed. Contractions where they'd naturally fall, not in every sentence. Sentences are as long as the thought needs: some short, some long and winding.`,
  academic: `A careful student writing for a marker. Formal register: no contractions, little or no first person unless the original uses it. Plain verbs (shows, uses, found) over inflated ones. Vary how sources are introduced: "(Author, year)" in some sentences, "Author (year) argues" in others. Sentence lengths can be fairly even; that's normal in academic prose.`,
  professional: `Someone who respects the reader's time. Clear and direct, no corporate speak. Contractions are fine. Gets to the point, then supports it.`,
  genz: `Dry, a bit funny, not trying too hard. Short lines mixed with longer ones. Still makes the actual point.`,
  storytelling: `Pull the reader through with a concrete scene or moment. Let the rhythm vary a lot. Asides go in commas or parentheses.`,
  friendly: `A knowledgeable friend over coffee. Uses "you" naturally, gives real examples, warm without performing it.`,
};

const REGIONS = {
  neutral: `Neutral international English.`,
  us: `American spelling and phrasing (realize, organize, gotten).`,
  uk: `British spelling and phrasing (realise, organise, whilst).`,
  student: `Sounds like a university student who cared about the assignment: informed, not stiff.`,
  nepali: `Natural Nepali-English: slightly formal, warm, no heavy American slang.`,
};

function rewriteSystemPrompt({ tone, region, facts }) {
  return `You rewrite AI-generated text so it reads like a specific person wrote it. Change how things are said, not what is claimed.

KEEP EXACTLY
Every claim, name and date. These items must appear in your rewrite character for character, attached to the same claim:
${describeFacts(facts)}
Never invent sources, numbers, quotes or details.

LISTS OF EXAMPLES
When the original lists three or more interchangeable examples ("smartphones, laptops, and tablets"), keep the one or two most relevant and drop the rest. Real writers rarely list three examples in every sentence. Never drop a name, number, date, citation or a distinct claim, only interchangeable examples.

VOICE
${TONES[tone] || TONES.casual}
${REGIONS[region] || REGIONS.neutral}

HOW HUMAN WRITING DIFFERS (from real human essays measured for this tool)
- Specific beats general. Keep and foreground every concrete detail: names, places, numbers, objects. Never trade a specific fact for a vaguer, grander one.
- Plain verbs: "is", "has", "was", "used", "wrote". Not "serves as", "stands as", "boasts", "features", "represents".
- Words repeat. If the subject is "communication", call it communication again. Don't cycle synonyms.
- Sentence length varies naturally: most between 10 and 25 words, about a third longer, a few very short. Don't chop everything into short punchy lines.
- Writers commit to claims. Few hedges.
- Keep roughly the same paragraph structure as the original.

AI PATTERNS TO REMOVE (from Wikipedia's "Signs of AI writing")
- Puffery about importance: "plays a pivotal role", "a testament to", "underscores the importance", "rich tapestry", "in today's world", "evolving landscape".
- "-ing" tails that add fake analysis: "…, highlighting its importance", "…, ensuring…", "…, fostering…".
- Reflective clichés: "There is something quietly remarkable about", "a certain nobility", "In an age when".
- Moral framing: "reminds us that", "teaches us", "deeper significance", "have become symbols of", "offers a model for". Don't end on a lesson or a neat moral ("That's the point:", "That's the model:"). End on a concrete fact or the last real point.
- Negative parallelism in any form: "not just X, but Y", "not X but Y", "It's not X, it's Y", "X, not Y", "no X, no Y, no Z". State what something is directly.
- Automatic groups of three, including three adjectives or three verbs in a row.
- Stock transitions and wrap-ups: Additionally, Furthermore, Moreover, Notably, In conclusion, Ultimately, Overall, "Despite these challenges".
- Vague attributions: "experts argue", "studies show" (unless the original names the source).
- AI vocabulary: delve, tapestry, testament, pivotal, crucial, foster, showcase, underscore, highlight, vibrant, intricate, multifaceted, seamless, robust, leverage, enhance, quietly, quiet, steady, steadily.
- Em dashes. Use commas, parentheses, colons or a new sentence instead.

Do not add filler, slang, fake typos, asides like "(and this matters)", or phrases like "Here's the thing" or "Honestly,". Human writing is plain more often than quirky.

Output only the rewritten text. No title, label or explanation.`;
}

function fixSystemPrompt(findings, facts) {
  return `You are editing a rewrite that still reads as AI-written. Fix only what is listed below; leave every other sentence exactly as it is.

PROBLEMS FOUND BY THE DETECTOR
${findings}

RULES
- Keep every claim. These items must stay character for character: ${describeFacts(facts).replace(/\n/g, " | ")}
- Rewrite a flagged pattern by saying the thing directly, not by swapping in a synonym or a different stock phrase.
- No em dashes, no "not X but Y", no groups of three, no closing moral.

Output only the corrected text.`;
}

function repairSystemPrompt(missing) {
  return `A rewrite dropped or altered items that must appear exactly as in the original. Put each one back, word for word, into the sentence that makes the same claim as in the original. Change nothing else.

MISSING ITEMS
${missing.map(m => `- ${m}`).join("\n")}

Output only the corrected text.`;
}

// Turn detector output into concrete instructions for the fix pass
function describeFindings(report) {
  const lines = [];
  const rh = report.signals.rhythm;
  if (rh.risk >= 0.3) {
    lines.push(`- Sentence lengths are too uniform (average ${rh.meanLength} words, variation ${rh.variation}; human writing is 0.35+). Merge some sentences, split others.`);
  }
  if (report.signals.specificity.risk >= 0.5) {
    lines.push(`- The text is generic. Use the concrete details from the original (names, numbers, places, objects) instead of summarising them. Do not invent new ones.`);
  }
  for (const [category, v] of Object.entries(report.signals.tells.byCategory)) {
    lines.push(`- ${category} (${v.count}×), e.g. ${v.examples.map(e => `"${e}"`).join(", ")}.`);
  }
  const flagged = report.sentences.filter(s => s.flagged).sort((a, b) => b.probability - a.probability).slice(0, 8);
  if (flagged.length) {
    lines.push(`- Sentences most likely to be flagged (rewrite these first):\n${flagged.map(s => `    • ${s.text}`).join("\n")}`);
  }
  return lines.join("\n");
}

async function humanize({ apiKey, text, tone, region }) {
  const input = detect(text);
  const facts = extractFacts(text);
  let calls = 0;
  const ask = async (system, user, effort) => { calls++; return complete({ apiKey, system, user, effort }); };

  const draft = await ask(rewriteSystemPrompt({ tone, region, facts }), `Rewrite this text:\n\n${text}`, "medium");
  let output = cleanup(draft);
  let report = detect(output);

  let fixPasses = 0;
  while (needsFix(report) && fixPasses < MAX_FIX_PASSES) {
    fixPasses++;
    const fixed = cleanup(await ask(
      fixSystemPrompt(describeFindings(report), facts),
      `Original (for facts only):\n${text}\n\nText to fix:\n${output}`,
      "medium"
    ));
    const fixedReport = detect(fixed);
    // Keep whichever version the detector rates more human; stop if no progress
    if (fixedReport.likelihood >= report.likelihood) break;
    output = fixed;
    report = fixedReport;
  }

  let missing = missingFacts(facts, output);
  if (missing.length) {
    const repaired = cleanup(await ask(repairSystemPrompt(missing), `Original:\n${text}\n\nRewrite to correct:\n${output}`, "low"));
    const stillMissing = missingFacts(facts, repaired);
    if (stillMissing.length < missing.length) {
      output = repaired;
      report = detect(output);
      missing = stillMissing;
    }
  }

  return {
    output,
    analysis: {
      inputAiScore: input.likelihood,
      outputHumanScore: 100 - report.likelihood,
      outputAiPercent: report.aiPercent,
      outputDisplay: report.display,
      flagsFound: Object.keys(report.signals.tells.byCategory),
      thirdPassTriggered: fixPasses > 0,
      fixPasses,
      missingFacts: missing,
      claudeCalls: calls,
    },
  };
}

module.exports = { humanize, rewriteSystemPrompt, describeFindings };
