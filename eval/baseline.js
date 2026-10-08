#!/usr/bin/env node
// ─────────────────────────────────────────────
// Measure the humanizer with the local detector.
//
//   node eval/baseline.js local              legacy post-processing only (no API calls)
//   node eval/baseline.js full [--all] [--pipeline=legacy|new|both]
//                                            full pipelines via Claude (user-* AI samples,
//                                            or every AI sample with --all)
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

// Share of the input's specifics (numbers, names, citations) that survive the rewrite
function specificsKept(input, output) {
  const grab = t => new Set((t.match(/\b\d[\d.,%]*\b|(?<=\s)\p{Lu}[\p{L}'’-]{2,}/gu) || []).map(x => x.toLowerCase()));
  const a = grab(input);
  if (!a.size) return "—";
  const b = output.toLowerCase();
  return Math.round(100 * [...a].filter(x => b.includes(x)).length / a.size) + "%";
}

const PIPELINES = {
  legacy: { label: "legacy", run: legacy.humanizeLegacy },
  new: { label: "new", run: require("../lib/pipeline").humanize },
};

async function runFull() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_api_key_here") {
    console.error("ANTHROPIC_API_KEY is not set. Create a .env file with ANTHROPIC_API_KEY=... first.");
    process.exit(1);
  }
  const which = (process.argv.find(a => a.startsWith("--pipeline=")) || "--pipeline=both").split("=")[1];
  const pipelines = which === "both" ? ["legacy", "new"] : [which];
  const samples = load("ai").filter(s => all || s.name.startsWith("user-"));
  console.log(`\nRunning ${pipelines.join(" + ")} on ${samples.length} AI samples…\n`);

  const rows = [];
  for (const s of samples) {
    const tone = s.name.includes("academic") ? "academic" : "casual";
    const before = detect(s.text);
    for (const key of pipelines) {
      const outDir = path.join(__dirname, "outputs", key);
      fs.mkdirSync(outDir, { recursive: true });
      const t0 = Date.now();
      try {
        const { output, analysis } = await PIPELINES[key].run({ apiKey, text: s.text, tone, region: "neutral" });
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        fs.writeFileSync(path.join(outDir, `${s.name}.txt`), output + "\n");
        rows.push({ s, key, tone, before, after: detect(output), secs, kept: specificsKept(s.text, output), fix: analysis.thirdPassTriggered, calls: analysis.claudeCalls ?? "5–6", lost: analysis.missingFacts ? analysis.missingFacts.length : "?" });
        console.log(`  ${pad(s.name, 34)} ${pad(key, 7)} done in ${secs}s`);
      } catch (err) {
        console.log(`  ${pad(s.name, 34)} ${pad(key, 7)} FAILED — ${err.message}`);
      }
    }
  }

  console.log("\n" + pad("sample", 34) + pad("pipeline", 9) + pad("words", 11) + pad("likelihood", 13) + pad("AI %", 12) + pad("specifics kept", 16) + pad("calls", 7) + pad("facts lost", 12) + "time");
  console.log("─".repeat(112));
  for (const r of rows) {
    console.log(
      pad(r.s.name, 34) + pad(r.key, 9) + pad(`${r.before.words}→${r.after.words}`, 11) +
      pad(`${r.before.likelihood} → ${r.after.likelihood}`, 13) +
      pad(`${r.before.aiPercent} → ${r.after.display}`, 12) + pad(r.kept, 16) +
      pad(r.calls, 7) + pad(r.lost, 12) + `${r.secs}s`
    );
  }
  for (const key of pipelines) {
    const mine = rows.filter(r => r.key === key);
    if (!mine.length) continue;
    const avgLik = avg(mine.map(r => r.after.likelihood)).toFixed(0);
    const avgPct = avg(mine.map(r => r.after.aiPercent)).toFixed(0);
    const avgSecs = avg(mine.map(r => +r.secs)).toFixed(1);
    console.log(`${pad(key, 8)} average: likelihood ${avgLik}, AI ${avgPct}%, ${avgSecs}s per text`);
  }
  console.log(`\nOutputs saved to eval/outputs/<pipeline>/ — inspect with: npm run eval -- eval/outputs/new/<file>.txt\n`);
}

if (mode === "full") runFull();
else runLocal();
