#!/usr/bin/env node
// ─────────────────────────────────────────────
// Measure the humanizer with the local detector.
//
//   node eval/baseline.js local              legacy post-processing only (no API calls)
//   node eval/baseline.js full [--all]       full legacy pipeline via Claude
//                                            (user-* AI samples, or every AI sample with --all)
//
// "local" runs the regex post-processing steps (word swaps, noise injection…)
// on every sample many times and reports how the detector score moves.
// "full" saves outputs to eval/outputs/legacy/ and scores them.
// ─────────────────────────────────────────────
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { detect } = require("../lib/detector");
const legacy = require("../lib/legacy-pipeline");
const { cleanup } = require("../lib/cleanup");

const SAMPLES_DIR = path.join(__dirname, "samples");
const OUT_DIR = path.join(__dirname, "outputs", "legacy");
const RUNS = 30;

const mode = process.argv[2] || "local";
const all = process.argv.includes("--all");

function load(label) {
  const dir = path.join(SAMPLES_DIR, label);
  return fs.readdirSync(dir).filter(f => f.endsWith(".txt")).sort()
    .map(name => ({ label, name: name.replace(/\.txt$/, ""), text: fs.readFileSync(path.join(dir, name), "utf8") }));
}

function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

// The exact post-processing chain from the legacy pipeline (after pass 2)
function legacyPostProcess(text) {
  let out = legacy.forceParagraphBreaks(text);
  out = legacy.structuralDisruption(out);
  out = legacy.postProcess(out);
  out = legacy.injectUnpredictableOpeners(out);
  out = legacy.injectHumanNoise(out);
  return out;
}

function runLocal() {
  const samples = [...load("human"), ...load("ai")];
  console.log(`\nLegacy post-processing only (no API). Each sample processed ${RUNS}× (it's random); averages shown.\n`);
  console.log(pad("sample", 46) + pad("label", 7) + pad("legacy: likelihood", 22) + pad("legacy: AI %", 15) + pad("new cleanup: lik. / AI %", 26) + "tells legacy added (examples)");
  console.log("─".repeat(140));
  const examples = [];
  for (const s of samples) {
    const before = detect(s.text);
    const runs = [];
    const added = new Map();
    for (let i = 0; i < RUNS; i++) {
      const out = legacyPostProcess(s.text);
      const r = detect(out);
      runs.push(r);
      const beforeTells = new Set(before.sentences.flatMap(x => x.tells.map(t => t.toLowerCase())));
      for (const t of r.sentences.flatMap(x => x.tells.map(t => t.toLowerCase()))) {
        if (!beforeTells.has(t)) added.set(t, (added.get(t) || 0) + 1);
      }
      if (i === 0 && s.label === "human") examples.push({ name: s.name, before: s.text, after: out });
    }
    const lik = avg(runs.map(r => r.likelihood));
    const pct = avg(runs.map(r => r.aiPercent));
    const clean = detect(cleanup(s.text));
    const top = [...added.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => `"${t}"`).join(", ") || "—";
    console.log(
      pad(s.name, 46) + pad(s.label, 7) +
      pad(`${before.likelihood} → ${lik.toFixed(0)} (${lik - before.likelihood >= 0 ? "+" : ""}${(lik - before.likelihood).toFixed(0)})`, 22) +
      pad(`${before.aiPercent} → ${pct.toFixed(0)}`, 15) + pad(`${clean.likelihood} / ${clean.aiPercent}`, 26) + top
    );
  }

  // Show concrete damage: sentences the word-swap step changed in human text
  console.log("\nWhat the word-swap step (postProcess) does to real human sentences:\n");
  let shown = 0;
  for (const s of load("human")) {
    const { splitText } = require("../lib/splitter");
    for (const seg of splitText(s.text)) {
      const swapped = legacy.postProcess(seg.text);
      if (swapped !== seg.text && shown < 6) {
        console.log(`  before: ${seg.text}`);
        console.log(`  after:  ${swapped}\n`);
        shown++;
      }
    }
  }
}

async function runFull() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_api_key_here") {
    console.error("ANTHROPIC_API_KEY is not set. Create a .env file with ANTHROPIC_API_KEY=... first.");
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const samples = load("ai").filter(s => all || s.name.startsWith("user-"));
  console.log(`\nFull legacy pipeline on ${samples.length} AI samples (≈6 Claude calls each)…\n`);
  const rows = [];
  for (const s of samples) {
    const tone = s.name.includes("academic") ? "academic" : "casual";
    const t0 = Date.now();
    try {
      const { output, analysis } = await legacy.humanizeLegacy({ apiKey, text: s.text, tone, region: "neutral" });
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      fs.writeFileSync(path.join(OUT_DIR, `${s.name}.txt`), output + "\n");
      const before = detect(s.text);
      const after = detect(output);
      rows.push({ s, before, after, secs, selfScore: analysis.outputHumanScore, words: after.words });
      console.log(`  ${s.name}: done in ${secs}s`);
    } catch (err) {
      console.log(`  ${s.name}: FAILED — ${err.message}`);
    }
  }
  console.log("\n" + pad("sample", 40) + pad("tone", 9) + pad("words in→out", 14) + pad("likelihood", 14) + pad("AI %", 14) + pad("self-score", 12) + "time");
  console.log("─".repeat(112));
  for (const { s, before, after, secs, selfScore } of rows) {
    console.log(
      pad(s.name, 40) + pad(s.name.includes("academic") ? "academic" : "casual", 9) +
      pad(`${before.words}→${after.words}`, 14) +
      pad(`${before.likelihood} → ${after.likelihood}`, 14) +
      pad(`${before.aiPercent} → ${after.display}`, 14) +
      pad(`${selfScore}/100`, 12) + `${secs}s`
    );
  }
  console.log(`\nOutputs saved to ${path.relative(process.cwd(), OUT_DIR)}/ — inspect with: npm run eval -- <file>\n`);
}

if (mode === "full") runFull();
else runLocal();
