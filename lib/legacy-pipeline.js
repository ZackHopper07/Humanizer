// ─────────────────────────────────────────────
// Legacy humanize pipeline, moved out of server.js unchanged so it can be
// run and measured without the HTTP server or Firebase auth.
// Step 2 replaces it piece by piece; keep it intact until then for baselines.
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ─────────────────────────────────────────────
// LAYER 1 — AI Pattern Analysis
// Detects AI fingerprints before rewriting
// ─────────────────────────────────────────────
function analyzeAIPatterns(text) {
  const sentences = text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const wordLengths = sentences.map(s => s.split(/\s+/).length);

  // Burstiness: standard deviation of sentence lengths
  const avg = wordLengths.reduce((a, b) => a + b, 0) / wordLengths.length;
  const variance = wordLengths.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / wordLengths.length;
  const burstiness = Math.sqrt(variance);

  // AI transition word detection
  const aiTransitions = [
    /\bfurthermore\b/gi, /\bmoreover\b/gi, /\badditionally\b/gi,
    /\bin conclusion\b/gi, /\bnotably\b/gi, /\bsubsequently\b/gi,
    /\bconsequently\b/gi, /\bin order to\b/gi, /\bthus\b/gi,
    /\bin summary\b/gi, /\bto summarize\b/gi, /\bit is important to note\b/gi,
    /\bit is worth noting\b/gi, /\bthis highlights\b/gi, /\bthis underscores\b/gi,
    /\bplays a crucial role\b/gi, /\bin today's world\b/gi,
  ];
  const transitionHits = aiTransitions.filter(r => r.test(text)).length;

  // AI word fingerprints
  const aiFingerprints = [
    /\butilize\b/gi, /\bdemonstrate\b/gi, /\bsignificantly\b/gi,
    /\bindividuals\b/gi, /\bimplement\b/gi, /\bleverage\b/gi,
    /\bfacilitate\b/gi, /\benhance\b/gi, /\brobust\b/gi,
    /\bstreamline\b/gi, /\boptimize\b/gi, /\bemphasize\b/gi,
    /\bshowcase\b/gi, /\bparadigm\b/gi, /\bsynergy\b/gi,
    /\bholistic\b/gi, /\btransformative\b/gi, /\bgroundbreaking\b/gi,
  ];
  const fingerprintHits = aiFingerprints.filter(r => r.test(text)).length;

  // Uniformity score: ratio of sentences within 2 words of average length
  const uniformCount = wordLengths.filter(l => Math.abs(l - avg) <= 2).length;
  const uniformity = uniformCount / wordLengths.length;

  // Repetitive starters
  const starters = sentences.map(s => s.split(' ')[0].toLowerCase());
  const starterFreq = {};
  starters.forEach(s => { starterFreq[s] = (starterFreq[s] || 0) + 1; });
  const repeatedStarters = Object.values(starterFreq).filter(v => v > 1).length;

  // Overall AI likelihood (0–100)
  let aiScore = 0;
  if (burstiness < 3) aiScore += 30;       // very uniform lengths
  else if (burstiness < 6) aiScore += 15;
  aiScore += Math.min(transitionHits * 8, 25);
  aiScore += Math.min(fingerprintHits * 4, 20);
  aiScore += uniformity > 0.6 ? 15 : uniformity > 0.4 ? 8 : 0;
  aiScore += Math.min(repeatedStarters * 3, 10);
  aiScore = Math.min(100, aiScore);

  return {
    burstiness: Math.round(burstiness * 10) / 10,
    uniformity: Math.round(uniformity * 100),
    transitionHits,
    fingerprintHits,
    repeatedStarters,
    avgSentenceLength: Math.round(avg * 10) / 10,
    sentenceCount: sentences.length,
    aiScore,
    // Problem flags to feed into rewriting prompt
    flags: {
      tooUniform: burstiness < 4,
      heavyTransitions: transitionHits >= 3,
      heavyFingerprints: fingerprintHits >= 4,
      repetitiveStarters: repeatedStarters >= 3,
      longSentences: avg > 20,
    }
  };
}

// ─────────────────────────────────────────────
// LAYER 2 — Semantic Preservation Layer
// Extracts meaning map BEFORE rewriting
// ─────────────────────────────────────────────
async function extractMeaningMap(apiKey, text) {
  const system = `You are a semantic analyst. Extract a concise meaning map from the given text.
Output ONLY valid JSON, no markdown, no explanation. Use this exact structure:
{
  "coreIntent": "one sentence describing what the text is fundamentally trying to say",
  "keyFacts": ["fact1", "fact2", "fact3"],
  "mainArgument": "the primary claim or thesis",
  "toneTarget": "the emotional/intellectual effect the text aims for",
  "mustPreserve": ["specific term, number, or claim that must not be changed"]
}`;

  try {
    const raw = await callClaude(apiKey, system,
      `Extract the meaning map from this text:\n\n${text}`, 0);
    const clean = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    // Fallback if parsing fails
    return {
      coreIntent: "Convey the information accurately",
      keyFacts: [],
      mainArgument: "",
      toneTarget: "informative",
      mustPreserve: []
    };
  }
}

// ─────────────────────────────────────────────
// LAYER 5b — Human-likeness Scoring
// Self-evaluate rewritten text, return 0–100
// ─────────────────────────────────────────────
async function scoreHumanLikeness(apiKey, text) {
  const system = `You are an AI detection expert. Score this text on how human it sounds.
Output ONLY valid JSON, no markdown:
{
  "score": <number 0-100, where 100 = perfectly human>,
  "issues": ["issue1", "issue2"],
  "passedChecks": ["check1", "check2"]
}
Score based on:
- Sentence length variation (burstiness)
- Presence of AI transition words
- Predictable phrase patterns
- Natural imperfection and thought flow
- Genuine conversational markers`;

  try {
    const raw = await callClaude(apiKey, system,
      `Score this text for human-likeness:\n\n${text}`, 0);
    const clean = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return { score: 50, issues: [], passedChecks: [] };
  }
}

// ─────────────────────────────────────────────
// POST-PROCESSING STEP 1 — Hard word-swap
// ─────────────────────────────────────────────
function postProcess(text) {
  const swaps = [
    [/\butilize[sd]?\b/gi, () => "use"],
    [/\butilizing\b/gi, () => "using"],
    [/\bdemonstrate[sd]?\b/gi, () => pick(["show", "prove", "make clear"])],
    [/\bdemonstrating\b/gi, () => pick(["showing", "proving"])],
    [/\bsignificantly\b/gi, () => pick(["really", "a lot", "quite a bit"])],
    [/\bsignificant\b/gi, () => pick(["major", "real", "actual", "big"])],
    [/\bindividuals\b/gi, () => pick(["people", "folks", "everyone"])],
    [/\bimplement(ed)?\b/gi, () => pick(["set up", "put in place", "roll out"])],
    [/\bimplementing\b/gi, () => pick(["setting up", "rolling out"])],
    [/\bobtain(ed)?\b/gi, () => pick(["get", "grab"])],
    [/\bassist(ed|s)?\b/gi, () => "help"],
    [/\bassistance\b/gi, () => "help"],
    [/\bnumerous\b/gi, () => pick(["many", "a lot of", "loads of", "tons of"])],
    [/\bsufficiently?\b/gi, () => "enough"],
    [/\bregarding\b/gi, () => pick(["about", "on", "around"])],
    [/\btherefore\b/gi, () => pick(["so", "which is why", "that's why"])],
    [/\bhowever\b/gi, () => pick(["but", "still", "yet", "though"])],
    [/\bin order to\b/gi, () => "to"],
    [/\bdue to the fact that\b/gi, () => "because"],
    [/\bhas the ability to\b/gi, () => "can"],
    [/\bit is important to\b/gi, () => pick(["make sure to", "you need to"])],
    [/\ba large number of\b/gi, () => pick(["many", "most", "tons of"])],
    [/\bprovide[sd]?\b/gi, () => pick(["give", "offer", "bring"])],
    [/\bproviding\b/gi, () => pick(["giving", "offering"])],
    [/\bensure[sd]?\b/gi, () => pick(["make sure", "keep"])],
    [/\bensuring\b/gi, () => "making sure"],
    [/\ballow[sd]?\b/gi, () => pick(["let", "mean"])],
    [/\ballowing\b/gi, () => pick(["letting", "meaning"])],
    [/\brequire[sd]?\b/gi, () => pick(["need", "take"])],
    [/\brequiring\b/gi, () => pick(["needing", "taking"])],
    [/\benhance[sd]?\b/gi, () => pick(["improve", "boost", "sharpen"])],
    [/\benhancing\b/gi, () => pick(["improving", "boosting"])],
    [/\bfacilitate[sd]?\b/gi, () => pick(["help", "drive", "make easier"])],
    [/\bfacilitating\b/gi, () => pick(["helping", "driving"])],
    [/\bstreamline[sd]?\b/gi, () => pick(["simplify", "clean up", "tighten"])],
    [/\bleverage[sd]?\b/gi, () => pick(["use", "lean on", "tap into"])],
    [/\bleveraging\b/gi, () => pick(["using", "tapping into"])],
    [/\brobust\b/gi, () => pick(["solid", "strong", "reliable"])],
    [/\bcutting-edge\b/gi, () => pick(["latest", "modern", "new"])],
    [/\bgroundbreaking\b/gi, () => pick(["new", "notable"])],
    [/\bunprecedented\b/gi, () => pick(["rare", "unusual", "new"])],
    [/\bparadigm\b/gi, () => "model"],
    [/\bsynergy\b/gi, () => "teamwork"],
    [/\bholistic(ally)?\b/gi, () => pick(["broad", "full", "complete"])],
    [/\btransformative\b/gi, () => pick(["powerful", "meaningful", "real"])],
    [/\bfurthermore\b/gi, () => pick(["and", "on top of that", "plus"])],
    [/\bmoreover\b/gi, () => pick(["and", "also", "on top of that"])],
    [/\badditionally\b/gi, () => pick(["and", "also", "plus"])],
    [/\bin conclusion\b/gi, () => pick(["so", "the bottom line is"])],
    [/\bnotably\b/gi, () => pick(["interestingly", "worth noting"])],
    [/\bsubsequently\b/gi, () => pick(["then", "after that", "next"])],
    [/\bconsequently\b/gi, () => pick(["so", "as a result", "which means"])],
    [/\bshowcase[sd]?\b/gi, () => pick(["show", "highlight", "display"])],
    [/\bshowcasing\b/gi, () => pick(["showing", "highlighting"])],
    [/\bactionable\b/gi, () => pick(["practical", "useful", "real"])],
    [/\bin today's (fast-paced )?world\b/gi, () => "these days"],
    [/\bat the end of the day\b/gi, () => pick(["when it comes down to it", "in reality"])],
    [/\bmoving forward\b/gi, () => pick(["going forward", "from here"])],
    [/\bin essence\b/gi, () => pick(["basically", "in short"])],
    [/\bundoubtedly\b/gi, () => pick(["no question", "clearly"])],
    [/\bplays a crucial role\b/gi, () => pick(["matters a lot", "is key", "is central"])],
    [/\bthis underscores\b/gi, () => pick(["this shows", "this proves"])],
    [/\bthis highlights\b/gi, () => pick(["this shows", "this points to"])],
    [/\bit is imperative\b/gi, () => "you have to"],
    [/\bone could argue\b/gi, () => pick(["I'd argue", "the case is"])],
    [/\bhas been shown to\b/gi, () => "tends to"],
    [/\bdelve[sd]? into\b/gi, () => pick(["get into", "dig into", "look at"])],
    [/\bgame-changer\b/gi, () => pick(["big shift", "real change"])],
    [/\brevolutionize[sd]?\b/gi, () => pick(["change", "reshape", "shake up"])],
    [/\bsubstantial(ly)?\b/gi, () => pick(["a lot", "heavily", "quite"])],
    [/\bpossess(es)?\b/gi, () => "have"],
    [/\bcommence[sd]?\b/gi, () => pick(["start", "begin", "kick off"])],
    [/\bterminate[sd]?\b/gi, () => pick(["end", "stop", "finish"])],
    [/\boptimize[sd]?\b/gi, () => pick(["improve", "tune", "sharpen"])],
    [/\bmitigate[sd]?\b/gi, () => pick(["reduce", "limit", "soften"])],
    [/\bencompass(es|ed)?\b/gi, () => pick(["cover", "include", "take in"])],
    [/\bemphasize[sd]?\b/gi, () => pick(["stress", "drive home", "point to"])],
    [/\bprioritize[sd]?\b/gi, () => pick(["focus on", "put first"])],
    [/\bincorporate[sd]?\b/gi, () => pick(["include", "bring in", "add"])],
    [/\bconducted?\b/gi, () => pick(["ran", "did", "carried out"])],
  ];
  let result = text;
  for (const [pattern, fn] of swaps) {
    result = result.replace(pattern, fn);
  }
  return result;
}

// ─────────────────────────────────────────────
// POST-PROCESSING STEP 2 — Max 2 paragraph enforcer
// Always collapses output to exactly 1 or 2 paragraphs
// ─────────────────────────────────────────────
function forceParagraphBreaks(text) {
  const existingParas = text.split(/\n\s*\n/).filter(p => p.trim());

  // Already 1 paragraph — leave it
  if (existingParas.length === 1) return existingParas[0].trim();

  // Already exactly 2 paragraphs — perfect
  if (existingParas.length === 2) {
    return existingParas.map(p => p.trim()).join('\n\n');
  }

  // More than 2 paragraphs — merge down to 2
  // First half of paragraphs → paragraph 1, rest → paragraph 2
  const mid = Math.ceil(existingParas.length / 2);
  const para1 = existingParas.slice(0, mid).map(p => p.trim()).join(' ');
  const para2 = existingParas.slice(mid).map(p => p.trim()).join(' ');
  return para1 + '\n\n' + para2;
}

// ─────────────────────────────────────────────
// POST-PROCESSING STEP 3 — Structural disruption
// ─────────────────────────────────────────────
function structuralDisruption(text) {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());

  return paragraphs.map(para => {
    let sentences = para.split(/(?<=[.!?])\s+/).filter(Boolean);

    sentences = sentences.map((s, i) => {
      const r = Math.random();

      if (r < 0.06 && s.split(' ').length > 12) {
        const words = s.split(' ');
        const mid = Math.floor(words.length * 0.5);
        return words.slice(0, mid).join(' ') + ', and ' +
               words[mid].toLowerCase() + ' ' +
               words.slice(mid + 1).join(' ');
      }

      if (r < 0.08 && i > 0) {
        const fillers = ['Right.', 'Okay.', 'So.', 'Yeah.', 'Anyway.', 'Still.'];
        return pick(fillers) + ' ' + s;
      }

      if (r < 0.08) {
        const qualifiers = [
          " Or at least that's how it usually goes.",
          " Most of the time, anyway.",
          " That part matters more than people think.",
          " It's not complicated, just easy to miss.",
          " Which is kind of the whole point.",
          " Not always, but often enough.",
        ];
        return s.replace(/[.!?]$/, '') + pick(qualifiers);
      }

      if (r < 0.05 && s.split(',').length > 2) {
        const parts = s.split(',');
        return parts.slice(0, -1).join(',') + '.';
      }

      if (r < 0.06) {
        const trails = [
          ", more or less.",
          ", though I could be wrong about that part.",
          ", which is kind of obvious in hindsight.",
          " Or something close to that.",
          " At least that's the general idea.",
        ];
        return s.replace(/[.!?]$/, '') + pick(trails);
      }

      return s;
    });

    return sentences.join(' ');
  }).join('\n\n');
}

// ─────────────────────────────────────────────
// POST-PROCESSING STEP 4 — Unpredictable openers
// ─────────────────────────────────────────────
function injectUnpredictableOpeners(text) {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  const openers = [
    "Here's the thing nobody says out loud:",
    "It's kind of obvious once you see it.",
    "Not to oversimplify,",
    "This is the part that actually matters.",
    "Most people skip this step.",
    "Weirdly, this is where it gets interesting.",
    "Worth saying plainly:",
    "Quick version:",
    "And honestly?",
    "The real issue is simpler than it looks.",
    "Here's what actually happens:",
    "Nobody talks about this part, but",
  ];

  return paragraphs.map((para, i) => {
    if (i === 0 || Math.random() > 0.35) return para;
    const sentences = para.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length < 2) return para;
    const idx = 1 + Math.floor(Math.random() * (sentences.length - 1));
    const opener = pick(openers);
    const s = sentences[idx];
    sentences[idx] = opener + ' ' + s.charAt(0).toLowerCase() + s.slice(1);
    return sentences.join(' ');
  }).join('\n\n');
}

// ─────────────────────────────────────────────
// POST-PROCESSING STEP 5 — Human noise injection
// ─────────────────────────────────────────────
function injectHumanNoise(text) {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());

  const mutated = paragraphs.map((para, i) => {
    let p = para.trim();

    if (Math.random() < 0.2 && i > 0) {
      p = pick(["And ", "But "]) + p.charAt(0).toLowerCase() + p.slice(1);
    }

    if (Math.random() < 0.12) {
      const sentences = p.split('. ');
      if (sentences.length > 2) {
        const idx = Math.floor(Math.random() * (sentences.length - 1));
        const asides = [
          " (at least in most cases)",
          " (and this matters)",
          " (which is kind of the whole point)",
          " (though it depends)",
          " (not always, but often)",
        ];
        const words = sentences[idx].split(' ');
        if (words.length > 5) {
          const insertAt = Math.floor(words.length / 2);
          words.splice(insertAt, 0, pick(asides));
          sentences[idx] = words.join(' ');
          p = sentences.join('. ');
        }
      }
    }

    if (Math.random() < 0.15) {
      const hedges = [
        "Honestly, ", "Look, ", "Here's the thing: ",
        "I mean, ", "To be fair, ", "Real talk: ",
      ];
      const sentences = p.split('. ');
      const idx = Math.floor(Math.random() * sentences.length);
      sentences[idx] = pick(hedges) + sentences[idx].charAt(0).toLowerCase() + sentences[idx].slice(1);
      p = sentences.join('. ');
    }

    if (Math.random() < 0.15) {
      const sentences = p.split('. ');
      if (sentences.length > 3) {
        const idx = Math.floor(Math.random() * (sentences.length - 1));
        const echoes = [
          " Or — put differently — ",
          " Which is another way of saying: ",
          " Actually, same point: ",
        ];
        sentences[idx] = sentences[idx] + pick(echoes) +
          sentences[idx + 1].charAt(0).toLowerCase() + sentences[idx + 1].slice(1) + ".";
        sentences.splice(idx + 1, 1);
        p = sentences.join('. ');
      }
    }

    if (Math.random() < 0.08) {
      const corrections = [
        ", actually,",
        ", or maybe not,",
        ", well, mostly,",
        ", sort of,",
      ];
      const sentences = p.split('. ');
      if (sentences.length > 2) {
        const idx = Math.floor(Math.random() * (sentences.length - 1));
        const words = sentences[idx].split(' ');
        if (words.length > 6) {
          const insertAt = Math.floor(words.length * 0.6);
          words.splice(insertAt, 0, pick(corrections));
          sentences[idx] = words.join(' ');
          p = sentences.join('. ');
        }
      }
    }

    if (Math.random() < 0.12 && i === paragraphs.length - 1) {
      const drifts = [
        " (Unrelated, but this kind of thing comes up more than people expect.)",
        " Not sure why that part gets glossed over, but it does.",
        " Anyway, that's just one way to think about it.",
        " It's a bit like how most problems aren't really new, just wearing different clothes.",
      ];
      p = p + " " + pick(drifts);
    }

    return p;
  });

  return mutated.join('\n\n');
}

// ─────────────────────────────────────────────
// Helper — single Claude API call
// ─────────────────────────────────────────────
async function callClaude(apiKey, systemPrompt, userContent, temperature = 1) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Anthropic API error");
  if (!Array.isArray(data.content)) throw new Error("Empty response from model");
  return data.content.filter(c => c.type === "text").map(c => c.text).join("");
}


// ─────────────────────────────────────────────
// Full pipeline: analysis → meaning map → pass 1 → pass 2 → post-processing
// → scoring (→ pass 3) → polish
// ─────────────────────────────────────────────
async function humanizeLegacy({ apiKey, text, tone, region }) {
  // ══════════════════════════════════════════════
  // LAYER 1 — AI Pattern Analysis (local, instant)
  // ══════════════════════════════════════════════
  const analysis = analyzeAIPatterns(text);

  // Build targeted problem report for the rewriter
  const problemFlags = [];
  if (analysis.flags.tooUniform)
    problemFlags.push(`⚠ BURSTINESS TOO LOW (${analysis.burstiness}) — sentence lengths are too uniform. Force extreme variation: 2-word sentences next to 30-word ones.`);
  if (analysis.flags.heavyTransitions)
    problemFlags.push(`⚠ ${analysis.transitionHits} AI TRANSITION WORDS found — replace every single one.`);
  if (analysis.flags.heavyFingerprints)
    problemFlags.push(`⚠ ${analysis.fingerprintHits} AI FINGERPRINT WORDS found — eliminate completely.`);
  if (analysis.flags.repetitiveStarters)
    problemFlags.push(`⚠ ${analysis.repeatedStarters} REPEATED SENTENCE STARTERS — vary every paragraph opener.`);
  if (analysis.flags.longSentences)
    problemFlags.push(`⚠ AVERAGE SENTENCE LENGTH IS ${analysis.avgSentenceLength} WORDS — too long. Cut more aggressively.`);

  const patternReport = problemFlags.length > 0
    ? `\nDETECTED ISSUES TO FIX:\n${problemFlags.join('\n')}\n`
    : `\nThis text has moderate AI patterns. Standard humanization applies.\n`;

  // ══════════════════════════════════════════════
  // LAYER 2 — Semantic Preservation (async)
  // ══════════════════════════════════════════════
  const meaningMap = await extractMeaningMap(apiKey, text);

  const semanticAnchor = `
SEMANTIC PRESERVATION — DO NOT CHANGE THESE:
Core intent: ${meaningMap.coreIntent}
Main argument: ${meaningMap.mainArgument || "see key facts"}
Key facts to preserve: ${meaningMap.keyFacts.join(' | ') || "none extracted"}
Must-preserve terms: ${meaningMap.mustPreserve.join(', ') || "none"}
`;

  // ── Tone instructions as emotional states
  const toneInstructions = {
    casual: `
Feels like texting a smart friend while slightly distracted.
Direct, but not optimized. Thinking out loud, not presenting.
Contractions happen naturally. Some sentences are sharp and short.
Others trail a little longer than they need to.
Occasional over-explaining is fine. "And" or "But" at sentence start is normal.
`,
    academic: `
A grad student who actually gets it — not performing intelligence, just thinking carefully.
First person is fine: "I'd argue", "what struck me here", "I'm not fully convinced by".
Precise when precision matters. Looser when it doesn't.
Em-dashes and semicolons where they feel natural.
Sentence lengths vary a lot — short punches, then one that uncoils slowly.
`,
    professional: `
Someone who respects the reader's time wrote this.
Short sentences hit hard. Longer ones carry nuance without padding.
No corporate speak. Contractions fine. There's a real person behind it.
Occasionally slightly informal. That's intentional.
`,
    genz: `
Substance wrapped in dry humor. Not trying too hard.
Rhetorical questions answered fast and bluntly.
Short punchy lines. Lowercase occasionally where it earns it.
Sarcasm where it lands. Still makes the actual point.
`,
    storytelling: `
Pull the reader through. Set a small scene somewhere.
Build a little tension and let it release.
Rhythm varies wildly — very short, then long and winding.
Em-dashes for quick asides. One slightly unnecessary example.
Should feel like something by the end, not just info delivered.
`,
    friendly: `
Knowledgeable friend explaining something over coffee.
Uses "you" a lot. Real examples. Contractions everywhere.
Warm but not performatively so. Occasionally wanders before coming back.
Ends like a conversation wrapping up naturally.
`,
  };

  const regionInstructions = {
    neutral: `Neutral international English. No heavy idioms or region-specific slang.`,
    us: `American English. "realize", "organize", "gotten". Casual American phrasing totally fine.`,
    uk: `British English. "realise", "organise", "whilst", "maths". Understated dry tone.`,
    student: `University student who cared about the assignment. Informed but not stiff. Real opinions where relevant.`,
    nepali: `Natural Nepali-English. Slightly formal but warm. South Asian sentence structures feel natural. Avoid heavy American slang.`,
  };

  // ── 4 style injections picked randomly each run
  const styleInjections = [
    "One sentence should slightly over-explain something obvious — like the writer lost focus for a second.",
    "Include one 'almost filler' sentence that adds tone, not meaning.",
    "Let one paragraph run a little longer than needed, then recover with a short sharp sentence right after.",
    "Use one contrast like 'Not that it matters much, but—' and then actually make it matter.",
    "Add one moment of hesitation through wording: 'sort of', 'kind of', 'I think', 'maybe'.",
    "One idea should appear twice — different emphasis each time. Not repetition, just return.",
    "Start 1–2 paragraphs mid-thought, like picking up a conversation already in progress.",
    "Use one very short paragraph — even a single sentence — as a punch between longer ones.",
    "Open two paragraphs with a blunt 3-word statement. Then expand.",
    "Use one rhetorical question answered immediately in the next sentence.",
    "Drop one deliberate comma splice somewhere. Real writers do this.",
    "Add one parenthetical aside: (and yes, that matters) or (which is the part most people skip).",
    "End one paragraph with a very short punchy sentence. One or two words is fine.",
    "Use 'actually' or 'honestly' once — and mean it.",
  ];

  const shuffled = styleInjections.sort(() => Math.random() - 0.5).slice(0, 4);
  const styleRules = shuffled.map((s, i) => `${i + 1}. ${s}`).join('\n');

  // ══════════════════════════════════════════════
  // PASS 1 — Full content rewrite (3-phase)
  // ══════════════════════════════════════════════
  const pass1System = `You are a human writer rewriting AI-generated text. Work through three internal phases.

${semanticAnchor}

${patternReport}

══════════════════════════════════════
PHASE 1 — INTENT FORMATION
══════════════════════════════════════
Before touching a word: what is this text trying to do?
What does the reader need to feel or know by the end?
Identify the 1–2 most important ideas. Everything else is support.
CRITICAL: Preserve the core intent and all key facts listed above.

TONE: ${toneInstructions[tone] || toneInstructions.casual}
REGION: ${regionInstructions[region] || regionInstructions.neutral}

══════════════════════════════════════
PHASE 2 — ROUGH DRAFT
══════════════════════════════════════
Rewrite from scratch — same facts, completely different feel.
Blow up sentence structures. Don't just swap words in the same shape.

❌ "Artificial intelligence has significantly transformed many industries."
✓  "AI changed things. A lot of industries don't look the same anymore."
✓  "Ask anyone in finance or healthcare — AI rewired how they work."

Tools: fragments · em-dash pivots · rhetorical questions · inversions · concrete-first openings

WHY AI GETS CAUGHT — FIX ALL THREE:

① PERPLEXITY — AI picks the safest, most predictable next word.
   You: occasionally pick the less obvious but still natural word.

② BURSTINESS — AI writes in uniform sentence lengths.
   Never three sentences of similar length in a row. Not once.
   Must include: 1 very short sentence (2–6 words) + 1 long multi-clause sentence + 1 medium one.

③ WORD FINGERPRINTS — replace every one without exception:
   utilize→use | demonstrate→show | significant→real/big/actual
   individuals→people | implement→set up | obtain→get
   assist→help | numerous→many | therefore→so | however→but/still
   in order to→to | provide→give | ensure→make sure | leverage→use
   furthermore→and | moreover→also | additionally→and
   showcase→show | facilitate→help | streamline→simplify
   consequently→so | subsequently→then | possess→have
   commence→start | emphasize→stress | incorporate→include

CONTRACTIONS — use constantly:
it's · don't · can't · won't · that's · you're · we've · I'd · they're
isn't · wasn't · hasn't · there's · I'm · couldn't · wouldn't · shouldn't
should've · would've · I'll · they'll · we're · didn't · doesn't

══════════════════════════════════════
PHASE 3 — HUMANIZATION
══════════════════════════════════════
IMPERFECT THINKING — do all of these:
- Let tone drift slightly within the response. Not consistent = human.
- Rephrase the same idea twice — slightly different angle each time.
- Allow one sentence to be slightly loose — not wrong, just unpolished.
- Self-correct mid-thought: "— actually, wait —" or "— or maybe that's not quite right —"

THOUGHT FLOW — writing should feel like thinking, not presenting:
- Allow sudden direction shifts
- Allow one slight digression that snaps back to the main point
- Include one slightly unnecessary example that still illuminates
- One sentence can start with "And" or "But"

STYLE RULES FOR THIS REWRITE:
${styleRules}

INTENT LAYERING:
1. Primary intent: the main answer
2. Secondary drift: one small aside or observation — subtle, never dominates

ANTI-PATTERN ALLOWANCE:
Allow 1–2 slightly AI-like moments: one formal phrasing, one structured sentence, one predictable transition.
Real humans write like this sometimes. Removing it all = over-corrected.

BANNED PHRASES — NEVER USE:
Furthermore · Moreover · In conclusion · It is important to note
Delve into · Leverage (verb) · Paradigm shift · Multifaceted
Unprecedented · In today's world · It goes without saying
Undoubtedly · This underscores · This highlights · Plays a crucial role
Showcase · Facilitate · Streamline · Robust · Cutting-edge
Game-changer · Revolutionize · Transformative · Holistic · Synergy
Actionable · Groundbreaking · Notably · Essentially · As an AI language model

PARAGRAPH RULES — HARD LIMIT:
- Output EXACTLY 2 paragraphs. Never more, never less.
- Each paragraph should be 3–5 clean, readable sentences.
- No run-on sentences. No sentence over 20 words.
- No stacking of multiple ideas into one sentence. One idea per sentence.
- Open each paragraph with a different type of opener.
- End with something that lands — not a summary, not a platitude.

SENTENCE CLEANLINESS:
- Every sentence must be easy to read on the first pass. No re-reading required.
- Cut any clause that doesn't add meaning. Shorter is better.
- No comma-heavy run-ons. If a sentence has 3+ commas, split it.
- Contractions and casual phrasing are fine — but keep sentences tight.
- Use em-dashes sparingly. At most one per paragraph, only when it genuinely helps.

PERPLEXITY SPIKING:
- At least 2 sentences should feel slightly "off" in a human way:
  unexpected word order, thought continuing past where it should stop,
  sentence starting one way and ending differently.
- Keep these readable — the "off" quality should be in word choice or rhythm, not in clarity.

CRITICAL FINAL INSTRUCTION — read this last:
Do NOT try to sound human. Humans don't try to sound human.
Instead:
1. Write one sentence you're not fully happy with but leave it anyway.
2. Let one paragraph make a point, then almost undercut it.
3. Use one word that's slightly wrong but everyone would understand.
4. End at least one sentence earlier than the "correct" ending would be.
5. One transition between paragraphs should feel slightly abrupt — like you moved on too fast.

Output ONLY the rewritten text. No intro. No label. No explanation.`;

  // ══════════════════════════════════════════════
  // PASS 2 — Structural destruction
  // ══════════════════════════════════════════════
  const pass2System = `You are a ruthless editor whose ONLY job is making writing sound LESS written.
You do NOT improve the writing. You make it rougher in very specific ways.
You preserve ALL facts and meaning exactly. Do not add or remove information.

APPLY ALL 8 OF THESE:
1. Find the 3 most polished-sounding sentences. Make each one rougher — awkward word order, cut a clause, or trim it shorter.
2. Any sentence that feels tangled or hard to follow: simplify it. Clean = good. Confusing = bad.
3. Find one place to add a mid-sentence correction using a comma: "well, actually," or "or maybe not,".
4. Remove or replace any sentence that sounds like a conclusion or wrap-up. Cut it or end more abruptly.
5. One paragraph should start with a lowercase connector where it flows: and, but, so.
6. Add one place where a thought trails off, qualifies itself heavily, or ends earlier than expected.
7. KEEP EXACTLY 2 PARAGRAPHS. Do not add, split, or merge paragraphs. The 2-paragraph structure is fixed.
8. One sentence should have a slightly wrong-but-understandable word — a near-synonym that's technically off but readable.

DO NOT:
- Add new information
- Change the overall meaning
- Make it confusing or unreadable
- Add any intro, label, or explanation

Output ONLY the revised text. Nothing else.`;

  // ── PASS 1: Full content rewrite
  const pass1Output = await callClaude(
    apiKey,
    pass1System,
    `Rewrite this through all three phases. Maximum structural change. Same facts, totally different feel.

HARD RULE: Output EXACTLY 2 paragraphs. Merge everything into 2 clean blocks.
Each sentence must be clear and easy to read on the first pass. No run-ons.

Internal checklist before outputting:
- Exactly 2 paragraphs? ✓
- Every sentence clean and readable in one pass? ✓
- No sentence over 20 words? ✓
- Tone drifted slightly at least once? ✓
- At least one very short sentence (2–6 words)? ✓
- 1–2 minor AI-like moments kept in (anti-pattern)? ✓
- All banned phrases gone? ✓
- At least 2 perplexity-spiked sentences? ✓
- Applied the 5 CRITICAL FINAL INSTRUCTIONS? ✓
- Preserved core intent and key facts from meaning map? ✓

Text:\n\n${text}`,
    1
  );

  // ── PASS 2: Structural destruction
  const pass2Output = await callClaude(
    apiKey,
    pass2System,
    `Apply all 8 rules to make this rougher. Preserve all facts and meaning.\n\n${pass1Output}`,
    1
  );

  // ── POST-PROCESSING PIPELINE
  let output = forceParagraphBreaks(pass2Output);
  output = structuralDisruption(output);
  output = postProcess(output);
  output = injectUnpredictableOpeners(output);
  output = injectHumanNoise(output);

  // ══════════════════════════════════════════════
  // LAYER 5 — Human-likeness Scoring Loop
  // If score < 70, run a targeted 3rd pass
  // ══════════════════════════════════════════════
  const humanScore = await scoreHumanLikeness(apiKey, output);

  let finalOutput = output;

  if (humanScore.score < 70) {
    const issueList = humanScore.issues.length > 0
      ? humanScore.issues.map((iss, i) => `${i + 1}. ${iss}`).join('\n')
      : "General AI patterns still detected.";

    const pass3System = `You are a precision humanizer. A previous rewrite scored ${humanScore.score}/100 on human-likeness.
Fix ONLY the specific issues listed. Do not change anything else.
Preserve all facts and meaning exactly.

ISSUES TO FIX:
${issueList}

Output ONLY the fixed text. No intro, no explanation.`;

    const pass3Output = await callClaude(
      apiKey,
      pass3System,
      `Fix the human-likeness issues in this text:\n\n${output}`,
      1
    );

    // Light post-processing on pass 3
    finalOutput = postProcess(pass3Output);
    finalOutput = injectHumanNoise(finalOutput);
  }

  // ══════════════════════════════════════════════
  // LAYER 6 — Output Polishing
  // Grammar smoothing without re-AI-ifying the text
  // ══════════════════════════════════════════════
  const polishSystem = `You are a copy editor doing a final light pass. Your job is minimal cleanup only.
Fix: obvious grammar errors, broken sentence fragments that don't work intentionally, doubled spaces, punctuation issues.
DO NOT: smooth out intentional roughness, replace informal language, make it more formal, change word choice, restructure paragraphs.
If something looks intentionally imperfect (em-dash pauses, comma splices, sentence fragments used for effect) — LEAVE IT.
Output ONLY the cleaned text. Nothing else.`;

  const polishedOutput = await callClaude(
    apiKey,
    polishSystem,
    `Do a minimal grammar cleanup. Preserve intentional roughness.\n\n${finalOutput}`,
    0
  );

  return {
    output: polishedOutput,
    analysis: {
      inputAiScore: analysis.aiScore,
      outputHumanScore: humanScore.score,
      burstiness: analysis.burstiness,
      flagsFound: Object.entries(analysis.flags)
        .filter(([, v]) => v)
        .map(([k]) => k),
      thirdPassTriggered: humanScore.score < 70,
    },
  };
}

module.exports = {
  humanizeLegacy,
  extractMeaningMap,
  callClaude,
  analyzeAIPatterns,
  postProcess,
  forceParagraphBreaks,
  structuralDisruption,
  injectUnpredictableOpeners,
  injectHumanNoise,
};
