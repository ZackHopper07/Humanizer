#!/usr/bin/env node
// ─────────────────────────────────────────────
// Detector eval harness
//
//   npm run eval                     score every sample, pass/fail table
//   npm run eval -- <file>           detailed per-sentence report for one file
//   npm run eval -- --json           machine-readable output
//
// Samples live in eval/samples/human (must score as human: < 20%)
// and eval/samples/ai (should score as AI: >= 60%).
// ─────────────────────────────────────────────
const fs = require("fs");
const path = require("path");
const { detect, QUALIFYING_WORDS } = require("../lib/detector");

const SAMPLES_DIR = path.join(__dirname, "samples");
const HUMAN_MAX = 20;  // human text must stay under Turnitin's highlight threshold
const AI_MIN = 60;

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const fileArg = args.find(a => !a.startsWith("--"));

function loadSamples() {
  const samples = [];
  for (const label of ["human", "ai"]) {
    const dir = path.join(SAMPLES_DIR, label);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith(".txt")) continue;
      samples.push({ label, name, text: fs.readFileSync(path.join(dir, name), "utf8") });
    }
  }
  return samples;
}

function topCategories(result, n = 3) {
  return Object.entries(result.signals.tells.byCategory)
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, n)
    .map(([c, v]) => `${c} ×${v.count}`)
    .join(", ") || "—";
}

function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }

function runAll() {
  const samples = loadSamples();
  const rows = samples.map(s => {
    const r = detect(s.text);
    const pass = s.label === "human" ? r.aiPercent < HUMAN_MAX : r.aiPercent >= AI_MIN;
    return { ...s, r, pass };
  });

  if (asJson) {
    console.log(JSON.stringify(rows.map(({ label, name, r, pass }) => ({
      label, name, pass, aiPercent: r.aiPercent, display: r.display, likelihood: r.likelihood,
      words: r.words, qualifying: r.qualifying, signals: r.signals,
    })), null, 2));
  } else {
    console.log("\n" + pad("sample", 46) + pad("label", 7) + pad("words", 7) + pad("AI %", 7) + pad("shown", 7) + pad("lik.", 6) + pad("rhythm", 8) + pad("tells/100w", 11) + "result");
    console.log("─".repeat(108));
    for (const { label, name, r, pass } of rows) {
      const words = r.qualifying ? r.words : `${r.words}*`;
      console.log(
        pad(name.replace(/\.txt$/, ""), 46) + pad(label, 7) + pad(words, 7) + pad(r.aiPercent, 7) +
        pad(r.display, 7) + pad(r.likelihood, 6) + pad(r.signals.rhythm.risk, 8) +
        pad(r.signals.tells.density, 11) + (pass ? "PASS" : "FAIL") +
        (r.definitive ? "  [chatbot leftovers]" : "")
      );
      console.log(pad("", 13) + "top tells: " + topCategories(r) +
        `  | variation ${r.signals.rhythm.variation}, specific ${r.signals.specificity.density}/100w, 8–20 band ${r.signals.rhythm.bandShare}%, runs ${r.signals.rhythm.similarRuns}`);
    }
    const human = rows.filter(r => r.label === "human");
    const ai = rows.filter(r => r.label === "ai");
    console.log("─".repeat(108));
    console.log(`human: ${human.filter(r => r.pass).length}/${human.length} under ${HUMAN_MAX}%   ` +
      `ai: ${ai.filter(r => r.pass).length}/${ai.length} at or above ${AI_MIN}%   ` +
      `(* = under ${QUALIFYING_WORDS} words, result less reliable)\n`);
  }

  // Human false positives are the hard failure
  process.exitCode = rows.some(r => r.label === "human" && !r.pass) ? 1 : 0;
}

function runOne(file) {
  const text = fs.readFileSync(file, "utf8");
  const r = detect(text);
  if (asJson) return console.log(JSON.stringify(r, null, 2));

  console.log(`\n${path.basename(file)} — AI ${r.display} (${r.aiPercent}%), likelihood ${r.likelihood}, ${r.words} words${r.qualifying ? "" : " (under 300: less reliable)"}`);
  const rh = r.signals.rhythm;
  console.log(`rhythm: risk ${rh.risk} | ${rh.sentences} sentences, mean ${rh.meanLength}, SD ${rh.lengthSD}, variation ${rh.variation}, 8–20 band ${rh.bandShare}%, similar runs ${rh.similarRuns}`);
  console.log(`specific: risk ${r.signals.specificity.risk} | ${r.signals.specificity.density} names/numbers per 100 words`);
  console.log(`tells:  risk ${r.signals.tells.risk} | ${r.signals.tells.density} weighted hits per 100 words`);
  for (const [c, v] of Object.entries(r.signals.tells.byCategory)) {
    console.log(`        ${pad(c, 26)} ×${pad(v.count, 3)} e.g. ${v.examples.join("; ")}`);
  }
  console.log(`dashes: ${r.signals.dashes.spaced} spaced em dashes (risk ${r.signals.dashes.risk})\n`);
  for (const s of r.sentences) {
    const mark = s.flagged ? "AI " : "   ";
    const tells = s.tells.length ? `  ← ${s.tells.join("; ")}` : "";
    console.log(`${mark}${s.probability.toFixed(2)}  ${s.text.length > 110 ? s.text.slice(0, 107) + "..." : s.text}${tells}`);
  }
  console.log();
}

if (fileArg) runOne(fileArg);
else runAll();
