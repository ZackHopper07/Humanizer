// ─────────────────────────────────────────────
// Humanize pipeline (Step 2 cleanup of the legacy pipeline)
//
//   meaning map → rewrite → cleanup → local detector check → (one targeted fix)
//
// Changes from lib/legacy-pipeline.js, each backed by the eval:
//   - Removed regex noise injection (structuralDisruption, injectUnpredictableOpeners,
//     injectHumanNoise) and the word-swap list: they broke grammar and raised
//     detector scores on human text (academic sample 0% → 29%)
//   - Removed pass 2 ("add a slightly wrong word", "well, actually,") and the
//     polish pass that existed to clean up after it
//   - Rewrite prompt no longer forces 2 paragraphs, a 20-word cap, constant
//     contractions, em dashes, or a ban on conclusions — the human samples do
//     the opposite of each
//   - Claude self-scoring replaced by the local detector, which also tells the
//     fix pass exactly what to change
// 2–3 Claude calls instead of 5–6.
// ─────────────────────────────────────────────
const { callClaude, extractMeaningMap } = require("./legacy-pipeline");
const { cleanup } = require("./cleanup");
const { detect } = require("./detector");

const FIX_THRESHOLD = 50;   // detector likelihood that triggers the targeted fix pass

const TONES = {
  casual: `Someone smart explaining this to a friend. Direct and relaxed. Contractions where they'd naturally fall, not in every sentence. Sentences are as long as the thought needs: some short, some long and winding.`,
  academic: `A careful student writing for a marker. Formal register: no contractions, little or no first person unless the original uses it. Plain verbs (shows, uses, found) over inflated ones. Keep every citation exactly as written and vary how sources are introduced: "(Author, year)" in some sentences, "Author (year) argues" in others. Sentence lengths can be fairly even; that's normal in academic prose.`,
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

function rewriteSystemPrompt({ tone, region, meaningMap }) {
  return `You rewrite AI-generated text so it reads like a specific person wrote it. Keep every fact, claim, name, number and citation. Change how it's said, not what's said.

WHAT MUST STAY
Core intent: ${meaningMap.coreIntent}
Main argument: ${meaningMap.mainArgument || "see key facts"}
Key facts: ${(meaningMap.keyFacts || []).join(" | ") || "none extracted"}
Must keep word-for-word: ${(meaningMap.mustPreserve || []).join(", ") || "none"}
Citations like "(Jones et al., 2014)" stay exactly as written, attached to the same claim. Never invent sources, numbers or quotes.

VOICE
${TONES[tone] || TONES.casual}
${REGIONS[region] || REGIONS.neutral}

HOW HUMAN WRITING DIFFERS (from real human essays measured for this tool)
- Specific beats general. Keep and foreground every concrete detail: names, places, numbers, dates, objects. Never trade a specific fact for a vaguer, grander one.
- Plain verbs: "is", "has", "was", "used", "wrote". Not "serves as", "stands as", "boasts", "features".
- Words repeat. If the subject is "communication", call it communication again. Don't cycle synonyms.
- Sentence length varies naturally: most fall between 10 and 25 words, about a third run longer, a few are very short. Don't chop everything into short punchy lines.
- Writers commit to claims. Few hedges.
- Paragraphs: keep roughly the same paragraph structure as the original.
- A closing line that sums up is fine if the original has one.

AI PATTERNS TO REMOVE (from Wikipedia's "Signs of AI writing")
- Puffery about importance: "plays a pivotal role", "a testament to", "underscores the importance", "rich tapestry", "in today's world", "evolving landscape".
- "-ing" tails that add fake analysis: "…, highlighting its importance", "…, ensuring…", "…, fostering…".
- Reflective clichés and moral framing: "There is something quietly remarkable about", "a certain nobility", "reminds us that", "teaches us", "deeper significance".
- Negative parallelism: "not just X, but Y", "It's not X — it's Y", "X, not Y", "no X, no Y, just Z".
- Automatic groups of three. Use two items, or four, or one, whatever the content actually has.
- Stock transitions and wrap-ups: Additionally, Furthermore, Moreover, Notably, In conclusion, Ultimately, "Despite these challenges".
- Vague attributions: "experts argue", "studies show" (unless the original cites one).
- AI vocabulary: delve, tapestry, testament, pivotal, crucial, foster, showcase, underscore, vibrant, intricate, multifaceted, seamless, robust, leverage, enhance, quietly, steady.
- Em dashes. Use commas, parentheses, colons or a new sentence instead.

Do not add filler, slang, fake typos, asides like "(and this matters)", or phrases like "Here's the thing" or "Honestly,". Human writing is plain more often than quirky.

Output only the rewritten text. No title, label or explanation.`;
}

function fixSystemPrompt(findings) {
  return `You are editing a rewrite that still reads as AI-written. Fix only what is listed. Keep every fact, name, number and citation exactly. Do not add anything new, and do not use em dashes.

PROBLEMS FOUND BY THE DETECTOR
${findings}

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
    lines.push(`- The text is generic: almost no names, numbers or concrete details. Bring forward every specific detail from the original instead of summarising it.`);
  }
  for (const [category, v] of Object.entries(report.signals.tells.byCategory)) {
    lines.push(`- ${category} (${v.count}×), e.g. ${v.examples.map(e => `"${e}"`).join(", ")}. Rewrite these.`);
  }
  const flagged = report.sentences.filter(s => s.flagged).slice(0, 6);
  if (flagged.length) {
    lines.push(`- Sentences most likely to be flagged:\n${flagged.map(s => `    • ${s.text}`).join("\n")}`);
  }
  return lines.join("\n");
}

async function humanize({ apiKey, text, tone, region }) {
  const input = detect(text);
  const meaningMap = await extractMeaningMap(apiKey, text);

  const draft = await callClaude(
    apiKey,
    rewriteSystemPrompt({ tone, region, meaningMap }),
    `Rewrite this text:\n\n${text}`,
    1
  );

  let output = cleanup(draft);
  let report = detect(output);
  let fixPassTriggered = false;

  if (report.likelihood >= FIX_THRESHOLD) {
    fixPassTriggered = true;
    const fixed = await callClaude(
      apiKey,
      fixSystemPrompt(describeFindings(report)),
      `Original (for facts only):\n${text}\n\nText to fix:\n${output}`,
      0.7
    );
    const fixedOutput = cleanup(fixed);
    const fixedReport = detect(fixedOutput);
    // Keep whichever version the detector rates more human
    if (fixedReport.likelihood <= report.likelihood) {
      output = fixedOutput;
      report = fixedReport;
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
      thirdPassTriggered: fixPassTriggered,
    },
  };
}

module.exports = { humanize, rewriteSystemPrompt, describeFindings, FIX_THRESHOLD };
