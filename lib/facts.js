// ─────────────────────────────────────────────
// Fact locking: the items a rewrite must carry over exactly —
// citations, numbers and short quotations. Checked after every rewrite;
// anything missing is sent back for a targeted repair.
// ─────────────────────────────────────────────

// (Jones et al., 2014)  (Department of Health (DoH), 2012)  (Kumar, 2013, p. 4)
const PAREN_CITATION_RE = /\((?:[^()]|\([^()]*\))*?\b(?:1[5-9]|20)\d{2}[a-z]?(?:,\s*pp?\.\s*[\d–-]+)?\)/g;
// Cohen et al. (2015)  /  Kumar (2013)
const NARRATIVE_CITATION_RE = /\b\p{Lu}[\p{L}'’-]+(?: et al\.| and \p{Lu}[\p{L}'’-]+)? \((?:1[5-9]|20)\d{2}[a-z]?\)/gu;
// 38, 3.5, 20%, 1,000, 2014 — standalone numbers written with digits
const NUMBER_RE = /(?<![\p{L}\d])\d[\d,]*(?:\.\d+)?%?(?![\p{L}\d])/gu;
// Short direct quotations (up to 25 words), straight or curly quotes
const QUOTE_RE = /["“]([^"“”]{3,200})["”]/g;

function unique(xs) { return [...new Set(xs.map(x => x.trim()).filter(Boolean))]; }

function extractFacts(text) {
  const found = unique([
    ...(text.match(PAREN_CITATION_RE) || []),
    ...(text.match(NARRATIVE_CITATION_RE) || []),
  ]);
  // "(2015)" is already covered by "Cohen et al. (2015)"
  const citations = found.filter(c => !found.some(o => o !== c && o.includes(c)));
  // Numbers inside citations are already covered by the citation
  const withoutCitations = citations.reduce((t, c) => t.split(c).join(" "), text);
  const numbers = unique(withoutCitations.match(NUMBER_RE) || []);
  const quotes = unique([...text.matchAll(QUOTE_RE)].map(m => m[1]))
    .filter(q => q.split(/\s+/).length <= 25);
  return { citations, numbers, quotes };
}

function normalise(s) {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").toLowerCase();
}

// Items from the input that don't appear in the output
function missingFacts(facts, output) {
  const out = normalise(output);
  const missing = [];
  for (const c of facts.citations) if (!out.includes(normalise(c))) missing.push(c);
  for (const n of facts.numbers) {
    const re = new RegExp(`(?<![\\d])${n.replace(/[.,%]/g, m => "\\" + m)}(?![\\d])`);
    if (!re.test(out)) missing.push(n);
  }
  for (const q of facts.quotes) if (!out.includes(normalise(q))) missing.push(`"${q}"`);
  return missing;
}

function describeFacts(facts) {
  const parts = [];
  if (facts.citations.length) parts.push(`Citations: ${facts.citations.join("; ")}`);
  if (facts.numbers.length) parts.push(`Numbers: ${facts.numbers.join(", ")}`);
  if (facts.quotes.length) parts.push(`Quotations: ${facts.quotes.map(q => `"${q}"`).join("; ")}`);
  return parts.join("\n") || "none";
}

module.exports = { extractFacts, missingFacts, describeFacts };
