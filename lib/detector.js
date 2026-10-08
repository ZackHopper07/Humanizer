// ─────────────────────────────────────────────
// Local AI-writing detector (rules only, no API calls)
//
// Signals, modelled on Turnitin's described approach and
// Wikipedia:Signs_of_AI_writing:
//   1. Rhythm (burstiness) — sentence-length spread, share of sentences in
//      the 8–20 word band, runs of similar-length sentences
//   2. Style tells — AI vocabulary, puffery, "-ing" tails, copula avoidance,
//      negative parallelism, formulaic conclusions, chatbot leftovers…
//      scored by density per 100 words, not by presence
//   3. Dash density — spaced em dashes
//   4. Humanizer artifacts — canned "human noise" phrases from spinners
//
// Output mirrors Turnitin's report: a per-sentence probability, the share of
// prose flagged as AI, "*%" for 1–19%, and a warning under 300 words.
// ─────────────────────────────────────────────
const { splitText } = require("./splitter");

const FLAG_THRESHOLD = 0.5;
const QUALIFYING_WORDS = 300;

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

// Each tell: id, category, weight per hit, regex (global, case-insensitive).
// Weights: 0.3–0.5 weak (humans use these too), 1 normal, 1.5 strong,
// 3+ near-certain (chatbot leftovers, citation artifacts).
const TELLS = [
  // ── AI vocabulary by era (Wikipedia: WP:AIWORDS)
  { id: "ai-vocab", category: "AI vocabulary", weight: 1, re: /\b(delv(e|es|ed|ing)|tapestry|testament|intricate|intricacies|interplay|meticulous(ly)?|bolster(s|ed|ing)?|garner(s|ed|ing)?|underscor(e|es|ed|ing)|showcas(e|es|ed|ing)|foster(s|ed|ing)?|vibrant|pivotal|multifaceted|seamless(ly)?|realm|nuanced|ever-evolving|ever-changing)\b/gi },
  { id: "ai-vocab-2", category: "AI vocabulary", weight: 0.6, re: /\b(additionally|crucial|enduring|enhanc(e|es|ed|ing)|align(s|ed)? with|highlight(s|ed|ing)?|robust|leverag(e|es|ed|ing)|prioritiz(e|es|ed|ing)|prioritis(e|es|ed|ing)|holistic|transformative|unwavering|invaluable|navigat(e|es|ing) (the|these|this|complex)|key (role|factor|aspect|component|element|insight|takeaway|driver|area|theme)s?|(digital|evolving|competitive|modern|educational|political|cultural) landscape)\b/gi },
  // Newer (2026) vocabulary — humans use these a lot, so weak
  { id: "ai-vocab-2026", category: "AI vocabulary", weight: 0.3, re: /\b(quietly|steady|dependable|clearer|echo(es|ed)|universally|practical|matters)\b/gi },

  // ── Undue significance / puffery (WP:AILEGACY, WP:AIPUFFERY)
  { id: "significance", category: "Puffery / significance", weight: 1.5, re: /\b((stands?|serves?|served) as a (testament|reminder|symbol|beacon)|a testament to|(plays?|played|playing) an? (crucial|pivotal|vital|key|significant|central|integral) role|(crucial|pivotal|vital|integral) (role|part|component|moment)|(underscores?|highlights?|emphasi[sz]es?) (the|its|their) (importance|significance|need)|reflects? (a )?broader|setting the stage|marking a (shift|turning point|new)|represents? a (shift|turning point|milestone)|turning point|focal point|indelible mark|deeply rooted|rich (history|heritage|tradition|cultural|tapestry)|nestled|in the heart of|boasts?|renowned|diverse array|commitment to|natural beauty|groundbreaking|cutting-edge|game[- ]changer|in today'?s (fast-paced |digital |interconnected |modern )?(world|age|society|landscape)|ever-changing world|enriching|unlock(ing)? the (full )?potential)\b/gi },

  // ── Superficial "-ing" tail clauses (WP:SUPERFICIAL)
  { id: "ing-tail", category: "Superficial -ing tail", weight: 1.5, re: /,\s+(highlighting|underscoring|emphasi[sz]ing|ensuring|reflecting|symboli[sz]ing|contributing to|cultivating|fostering|encompassing|enhancing|showcasing|solidifying|reinforcing|paving the way|demonstrating|illustrating|making it|allowing for|enabling|promoting|resulting in)\b/gi },

  // ── Avoiding plain "is/has" (WP:AINOCOPULA)
  // (lookahead skips "serves as a testament/reminder…", already counted as puffery)
  { id: "copula-avoid", category: "Avoids is/has", weight: 1, re: /\b(serves? as|served as|stands? as|functions? as|acts? as an?|holds? the distinction|boasts an?)\b(?! an? (testament|reminder|symbol|beacon)\b)/gi },

  // ── Negative parallelism (WP:AIPARALLEL)
  { id: "neg-parallel", category: "Negative parallelism", weight: 1, re: /\b(not (only|just|merely|simply|as)\b[^.!?]{1,80}\bbut( also| as)?\b|(it'?s|it is|this is|that'?s) not (just |only |merely |simply )?(about )?[^.!?,;]{1,50}[,;—–-]+\s*(it'?s|it is|but)\b|(isn'?t|wasn'?t|aren'?t|weren'?t|is not|was not|are not|were not)\b[^.!?]{1,80}\s[—–]\s(it|they|this|that|he|she)('s|'re| is| was| are| were)\b)/gi },
  // "X, not Y." and "— but not Y" — weaker, humans write "given, not created" too
  { id: "neg-parallel-short", category: "Negative parallelism", weight: 0.7, re: /(,\s+not (a |an |the )?[\p{L}-]+( [\p{L}-]+){0,4}[.!?]|\s[—–]\s(but )?not\b)/giu },

  // ── Spaced em dashes (WP:AIDASH) — Claude in particular overuses them
  { id: "em-dash", category: "Spaced em dash", weight: 0.8, re: /\s[—–]\s/g },

  // ── Rule of three (WP:RO3) — items of 1–3 words: "explore, learn, and understand",
  // "new experiences, meaningful conversations, and unexpected opportunities"
  { id: "triad", category: "Rule of three", weight: 0.6, re: /\b[\p{L}-]+(?: [\p{L}-]+){0,2}, [\p{L}-]+(?: [\p{L}-]+){0,2},? and [\p{L}-]+(?: [\p{L}-]+){0,2}\b/giu },

  // ── Generic stock phrasing — the "regression to the mean" the Wikipedia guide describes
  { id: "generic", category: "Generic stock phrase", weight: 1, re: /\b(the world around (us|them|you)|both personally and professionally|personal and professional (growth|development|lives)|in everyday life|in (our|their) daily lives|one of the most (powerful|important|valuable|essential|significant|effective)|meaningful (conversations|connections|experiences|impact|relationships|change)|(new|unexpected|endless|countless) (opportunities|possibilities)|opportunities for (growth|discovery|learning)|in creative ways|a deeper understanding|(grow|growth) as (a person|individuals)|make a (positive|lasting|real) (impact|difference)|(thoughtful|well-rounded|knowledgeable|adaptable|resilient) individuals|on a (personal|deeper) level|shape (who we are|the future)|a sense of (purpose|belonging|community))\b/gi },

  // ── Vague attributions (WP:AIWEASEL)
  { id: "weasel", category: "Vague attribution", weight: 1, re: /\b(experts (argue|say|believe|note|suggest|agree)|observers (have )?(noted|cited|argue)|critics (argue|say|note)|studies (show|suggest|have shown)|research (shows|suggests|indicates)|industry reports|some (argue|believe|say)|many (believe|argue|experts)|it is widely (believed|accepted|recognized|recognised))\b/gi },

  // ── Didactic and hedging disclaimers (WP:DIDACTIC, WP:AIDISCLAIMER)
  { id: "disclaimer", category: "Disclaimer", weight: 1.5, re: /\b((it'?s|it is) (important|crucial|essential|worth|vital) (to (note|remember|consider|recognize|recognise|understand)|noting)|worth noting|should be (treated|understood|seen|viewed) as\b[^.]{0,60}\brather than|does not by itself|based on (the )?available information|not widely (available|documented|known)|may vary)\b/gi },

  // ── Formulaic structure and conclusions (WP:FACESCHALLENGES, WP:CONCLUSION)
  { id: "formula", category: "Formulaic conclusion", weight: 1.5, re: /\b(in conclusion|in summary|to sum up|to summari[sz]e|overall(?=,)|ultimately(?=,)|despite (these|its|their|the) (challenges|limitations)|faces? (several|many|significant|numerous) challenges|future outlook|(is|are) poised to|looking ahead|moving forward|as we move forward|the future (of [^.]{1,30})?(looks|is) bright)\b/gi },

  // ── Stock sentence-opening transitions — weak on their own (per Wikipedia)
  { id: "transition", category: "Stock transition", weight: 0.5, re: /(^|[.!?]\s+)(additionally|furthermore|moreover|consequently|notably|subsequently|thus|hence|in addition|importantly),/gi },

  // ── Chatbot leftovers (WP:COLLABCOMM) — near-certain
  { id: "chat-leak", category: "Chatbot leftover", weight: 4, re: /\b(certainly!|of course!|absolutely!|great question|i hope this helps|let me know if|would you like (me )?to|feel free to|here is (a|an|the) (revised|rewritten|updated|draft)|here'?s (a|an|the) (revised|rewritten|updated)|as an ai\b|as a large language model|i cannot (provide|offer)|is there anything else)/gi },

  // ── Unfilled placeholders (WP:AIPLACEHOLDER)
  { id: "placeholder", category: "Placeholder", weight: 4, re: /(\[(your |insert |add )?(name|company|date|title|topic|entertainer'?s name|[a-z ]{2,25} here)\]|\(add [^)]{1,40} here\)|\b20\d{2}-xx-xx\b)/gi },

  // ── Citation/markup artifacts from chatbots (WP:OAICITE) — definitive
  { id: "artifact", category: "Chatbot artifact", weight: 6, re: /(contentReference|oaicite|oai_citation|turn\d+(search|image|news|file)\d+|\[cite:\s*\d|【\d+†|utm_source=(chatgpt|openai|copilot)|referrer=grok|grok_card|start_span|end_span|\[attached_file:\d|ppl-ai-file-upload|:::writing)/gi },

  // ── Markdown formatting in prose (WP:AIMARKDOWN, WP:AIBOLD, WP:AIEMOJI)
  { id: "markdown-bold", category: "Markdown / formatting", weight: 1, re: /\*\*[^*\n]{1,80}\*\*/g },
  { id: "emoji", category: "Markdown / formatting", weight: 1, re: /\p{Extended_Pictographic}/gu },

  // ── Canned "human noise" from humanizers/spinners (incl. our own old pipeline)
  { id: "humanizer-canned", category: "Humanizer artifact", weight: 2, re: /\b(real talk:|here'?s the thing( nobody says out loud)?:|or — put differently —|which is another way of saying:|actually, same point:|though i could be wrong about that part|or something close to that|at least that'?s the general idea|which is kind of the whole point|that part matters more than people think|it'?s not complicated, just easy to miss|not to oversimplify,|weirdly, this is where it gets interesting|nobody talks about this part|\((at least in most cases|and this matters|though it depends|not always, but often)\))/gi },
  { id: "hedge", category: "Humanizer artifact", weight: 0.4, re: /(^|[.!?]\s+)(honestly|look|basically|i mean|to be fair|anyway|right|okay|so|yeah|still)[,.]\s/gi },
];

const SPACED_EM_DASH_RE = /\s[—–]\s|\s--\s/g;
const ANY_EM_DASH_RE = /—|--/g;

function findTells(text) {
  const hits = [];
  for (const t of TELLS) {
    t.re.lastIndex = 0;
    for (const m of text.matchAll(t.re)) {
      hits.push({ id: t.id, category: t.category, weight: t.weight, match: m[0].trim() });
    }
  }
  return hits;
}

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / (xs.length || 1); }
function sd(xs) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
}

// Burstiness. Thresholds come from the human baseline samples: relative
// variation (SD ÷ mean) 0.29–0.49, 30–71% in the 8–20 band, ~3% similar-length
// runs. Relative variation catches uniform text at any length — the 2026 style
// sits in 8–20 words, older GPT style in 18–25.
function analyzeRhythm(lengths) {
  const n = lengths.length;
  const inBand = lengths.map(l => l >= 8 && l <= 20);
  const inRun = new Array(n).fill(false);
  let runs = 0;
  for (let i = 0; i + 2 < n; i++) {
    const w = lengths.slice(i, i + 3);
    if (Math.max(...w) - Math.min(...w) <= 3) {
      runs++;
      inRun[i] = inRun[i + 1] = inRun[i + 2] = true;
    }
  }
  const lengthSD = n ? sd(lengths) : 0;
  const bandShare = n ? inBand.filter(Boolean).length / n : 0;
  const runShare = n >= 3 ? runs / (n - 2) : 0;

  const variation = n ? lengthSD / (mean(lengths) || 1) : 0;

  const variationRisk = clamp((0.38 - variation) / 0.18);
  const bandRisk = clamp((bandShare - 0.6) / 0.3);
  const runRisk = clamp((runShare - 0.05) / 0.25);
  // Few sentences = unreliable rhythm; fade it in from 3 to 8 sentences
  const confidence = clamp((n - 2) / 6);
  const risk = (0.5 * variationRisk + 0.25 * bandRisk + 0.25 * runRisk) * confidence;

  return {
    sentences: n,
    meanLength: round1(mean(lengths)),
    lengthSD: round1(lengthSD),
    variation: round2(variation),
    bandShare: Math.round(bandShare * 100),
    similarRuns: runs,
    runShare: Math.round(runShare * 100),
    confidence: round2(confidence),
    risk: round2(risk),
    inBand,
    inRun,
  };
}

// Specificity: names, places, numbers and dates per 100 words — capitalised
// words that don't start a sentence (excluding "I"), plus anything with a digit.
// Human samples: 3.1–14.5. Generic AI text: 0–1.
function analyzeSpecificity(prose) {
  let specific = 0;
  let words = 0;
  for (const s of prose) {
    const tokens = s.text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
    words += tokens.length;
    tokens.forEach((w, i) => {
      if (/\p{N}/u.test(w)) specific++;
      else if (i > 0 && /^\p{Lu}/u.test(w) && !/^I(['’]|$)/u.test(w)) specific++;
    });
  }
  const density = words ? (specific / words) * 100 : 0;
  return { density: round1(density), risk: round2(clamp((2.5 - density) / 2.0)) };
}

const round1 = x => Math.round(x * 10) / 10;
const round2 = x => Math.round(x * 100) / 100;

function displayPercent(pct) {
  if (pct === 0) return "0%";
  if (pct < 20) return "*%";
  return `${pct}%`;
}

function detect(text) {
  const segments = splitText(text || "");
  const prose = segments.filter(s => s.kind === "prose" && s.words > 0);
  const totalWords = segments.reduce((a, s) => a + s.words, 0);
  const proseWords = prose.reduce((a, s) => a + s.words, 0);

  // Tells are counted over every segment (headings and lists included),
  // since markdown and chatbot leftovers usually live there.
  const segTells = segments.map(s => findTells(s.text));
  const allTells = segTells.flat();
  const tellWeight = allTells.reduce((a, h) => a + h.weight, 0);
  const tellDensity = totalWords ? (tellWeight / totalWords) * 100 : 0;
  const tellRisk = clamp((tellDensity - 0.6) / 2.4);

  const spacedDashes = (text.match(SPACED_EM_DASH_RE) || []).length;
  const dashDensity = totalWords ? (spacedDashes / totalWords) * 100 : 0;
  const dashRisk = clamp((dashDensity - 0.5) / 1.0);

  const structure = {
    headings: segments.filter(s => s.kind === "heading").length,
    listItems: segments.filter(s => s.kind === "list").length,
  };
  const structureRisk = clamp((structure.headings + structure.listItems) / Math.max(1, segments.length) * 2);

  const rhythm = analyzeRhythm(prose.map(s => s.length));
  const specificity = analyzeSpecificity(prose);
  const definitive = allTells.some(h => h.id === "artifact" || h.id === "chat-leak" || h.id === "placeholder");

  // Per-sentence probability: independent evidence combined with noisy-OR.
  const proseIndex = new Map(prose.map((s, i) => [s.index, i]));
  const sentences = segments.map((s, k) => {
    const tells = segTells[k];
    const localWeight = tells.reduce((a, h) => a + h.weight, 0);
    const i = proseIndex.get(s.index);

    const rTell = clamp(localWeight / 2.5);
    // Generic text alone shouldn't flag (abstract human essays exist), so it
    // only adds to the other evidence
    const rDoc = 1 - (1 - tellRisk * 0.7) * (1 - specificity.risk * 0.4);
    const rRhythm = i === undefined
      ? structureRisk * 0.8
      : rhythm.risk * (rhythm.inBand[i] ? 1 : 0.6) * (rhythm.inRun[i] ? 1 : 0.85);

    let p = 1 - (1 - rTell) * (1 - rDoc) * (1 - rRhythm);
    if (tells.some(h => h.weight >= 4)) p = 1;

    return {
      text: s.text,
      kind: s.kind,
      words: s.words,
      probability: round2(p),
      flagged: p >= FLAG_THRESHOLD,
      tells: tells.map(h => h.match),
    };
  });

  const flaggedWords = sentences.filter(s => s.flagged).reduce((a, s) => a + s.words, 0);
  const aiPercent = totalWords ? Math.round((flaggedWords / totalWords) * 100) : 0;
  const likelihood = totalWords
    ? Math.round(sentences.reduce((a, s) => a + s.probability * s.words, 0) / totalWords * 100)
    : 0;

  const byCategory = {};
  for (const h of allTells) {
    const c = (byCategory[h.category] ||= { count: 0, weight: 0, examples: [] });
    c.count++;
    c.weight = round1(c.weight + h.weight);
    if (c.examples.length < 4 && !c.examples.includes(h.match.toLowerCase())) c.examples.push(h.match.toLowerCase());
  }

  return {
    aiPercent,                       // share of text flagged as AI (Turnitin-style)
    display: displayPercent(aiPercent),
    likelihood,                      // word-weighted mean probability, finer-grained
    qualifying: proseWords >= QUALIFYING_WORDS,
    definitive,                      // chatbot leftovers / artifacts found
    words: totalWords,
    proseWords,
    signals: {
      rhythm: { ...rhythm, inBand: undefined, inRun: undefined },
      specificity,
      tells: { density: round2(tellDensity), risk: round2(tellRisk), byCategory },
      dashes: { spaced: spacedDashes, total: (text.match(ANY_EM_DASH_RE) || []).length, density: round2(dashDensity), risk: round2(dashRisk) },
      structure: { ...structure, risk: round2(structureRisk) },
    },
    sentences,
  };
}

module.exports = { detect, TELLS, FLAG_THRESHOLD, QUALIFYING_WORDS };
