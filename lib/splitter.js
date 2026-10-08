// ─────────────────────────────────────────────
// Sentence splitter
// Handles abbreviations ("et al.", "e.g.", "Dr."), initials, decimals,
// ellipses that continue a sentence, and closing quotes/brackets.
// ─────────────────────────────────────────────

// Lowercased, without the trailing period. A period after one of these
// does not end a sentence.
const ABBREVIATIONS = new Set([
  "al", "e.g", "i.e", "cf", "vs", "v", "approx", "ca", "viz",
  "dr", "mr", "mrs", "ms", "prof", "sr", "jr", "st", "mt", "rev", "gen", "col", "lt", "sgt",
  "no", "nos", "fig", "figs", "vol", "vols", "pp", "p", "ed", "eds", "ch", "sec", "para",
  "inc", "ltd", "co", "corp", "dept", "univ", "assn",
  "u.s", "u.k", "u.n", "e.u", "a.m", "p.m", "ph.d", "b.a", "m.a", "b.sc", "m.sc",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const TERMINATOR_RE = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
const LIST_ITEM_RE = /^\s*(?:[-*•–]|\d+[.)])\s+/;
const HEADING_RE = /^\s*#{1,6}\s+/;

// Parenthetical citations: (Jones et al., 2014), (Department of Health (DoH), 2012), (2015)
const CITATION_RE = /\s*\((?:[^()]|\([^()]*\))*?\b(?:1[5-9]|20)\d{2}[a-z]?(?:,\s*p+\.\s*[\d–-]+)?\)/g;

function countWords(text) {
  return (text.match(WORD_RE) || []).length;
}

function stripCitations(text) {
  return text.replace(CITATION_RE, "");
}

function endsWithAbbreviation(chunk) {
  const m = chunk.match(/([\p{L}.]+)\.$/u);
  if (!m) return false;
  const token = m[1].toLowerCase().replace(/\.$/, "");
  if (ABBREVIATIONS.has(token)) return true;
  // Single-letter initial: "J. K. Rowling"
  return /^\p{Lu}$/u.test(m[1]);
}

function isBoundary(chunk, after, punct) {
  if (!after) return true;
  const first = after[0];
  // "Santería... so I shunned it", "e.g. the" — sentence continues
  if (/\p{Ll}/u.test(first)) return false;
  // A single period after an abbreviation or initial: "Cohen et al. (2015)", "Dr. Smith"
  if (punct.replace(/["'”’)\]]+$/, "") === "." && endsWithAbbreviation(chunk)) return false;
  // Next sentence starts with a capital, digit, or an opening quote/bracket
  return /[\p{Lu}\p{N}"'“‘(\[]/u.test(first);
}

function splitSentences(paragraph) {
  const sentences = [];
  let start = 0;
  let m;
  TERMINATOR_RE.lastIndex = 0;
  while ((m = TERMINATOR_RE.exec(paragraph))) {
    const end = m.index + m[0].length;
    const chunk = paragraph.slice(start, end);
    const after = paragraph.slice(end).trimStart();
    if (!isBoundary(chunk, after, m[0])) continue;
    if (chunk.trim()) sentences.push(chunk.trim());
    start = end;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

// Split a document into segments. Prose paragraphs are split into sentences;
// list items and headings are kept whole and marked, because (like Turnitin)
// we only measure rhythm on continuous prose.
function splitText(text) {
  const segments = [];
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  blocks.forEach((block, paragraph) => {
    let prose = [];
    const flush = () => {
      if (!prose.length) return;
      for (const s of splitSentences(prose.join(" "))) {
        segments.push({ text: s, kind: "prose", paragraph });
      }
      prose = [];
    };
    for (const line of block.split("\n")) {
      if (!line.trim()) continue;
      if (HEADING_RE.test(line)) {
        flush();
        segments.push({ text: line.trim(), kind: "heading", paragraph });
      } else if (LIST_ITEM_RE.test(line)) {
        flush();
        segments.push({ text: line.trim(), kind: "list", paragraph });
      } else {
        prose.push(line.trim());
      }
    }
    flush();
  });
  return segments.map((s, index) => ({
    ...s,
    index,
    words: countWords(s.text),
    // Length used for rhythm: citations removed so "(Jones et al., 2014)" doesn't inflate it
    length: countWords(stripCitations(s.text)),
  }));
}

module.exports = { splitText, splitSentences, countWords, stripCitations };
