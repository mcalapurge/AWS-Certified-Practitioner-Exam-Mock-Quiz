#!/usr/bin/env node
// Validate the prebuilt (Claude) practice questions that a piece of work adds or
// changes, and write the review results back into the source data.
//
// A "piece of work" is everything between a base git ref (by default the
// merge-base with origin/main, i.e. what a PR/MR would show) and the working
// tree, so uncommitted edits are included. The flow, driven by the
// validate-questions skill (.claude/skills/validate-questions/SKILL.md):
//
//   diff      list added / changed / retagged / removed questions per bank, lint
//             them, and say which still need a review. Exit 1 on lint errors.
//   prepare   write blind review batches (no key, no explanation) for reviewer
//             subagents, plus a manifest that pins each item's content.
//   compare   score the reviewers' answers against the key and write the items
//             that need adjudication (disagreement, low confidence, issues).
//   apply     apply adjudication patches, then populate each reviewed question's
//             `confidence` rating, fill a missing `source_id`, and refresh the
//             bank's `total_questions` and `actual_domain_distribution`.
//   keywords  suggest (or --write) study-guide keywords so every question in
//             scope maps to its own topic in the weak-topic matcher.
//   lint      lint every question in every bank (errors only unless --verbose),
//             and fail a bank whose keyed option is the longest too often.
//
// Options: --base <ref>  --out <dir> (default report/question-review)
//          --batch-size <n> (default 15)  --all  --json  --write  --date <YYYY-MM-DD>
//          --allow-unresolved  --root <dir> (tests)

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const SCHEMA_VERSION = 1;
export const SOURCES_REL = "scripts/sources";
export const DEFAULT_OUT_REL = "report/question-review";
export const LETTERS = ["A", "B", "C", "D"];
/** Fields that decide whether the keyed answer is right; editing one needs a fresh review. */
export const CONTENT_FIELDS = ["question", "options", "correct", "explanation"];
/** Tagging fields; changing only these is a retag and doesn't need a review. */
export const TAG_FIELDS = ["domain", "topic", "complexity", "topic_difficulty"];
export const ANTHROPIC_DOCS =
  /^https:\/\/(platform\.claude\.com|code\.claude\.com|docs\.anthropic\.com|(www\.)?anthropic\.com)\//;
const LEVELS = ["low", "medium", "high"];
const VERDICTS = ["keep", "fix", "rekey", "dispute"];
const COUNT_WORDS = { 2: "TWO", 3: "THREE", 4: "FOUR" };

const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** JSON with sorted object keys, so option order or key order never reads as a change. */
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(q) {
  const content = Object.fromEntries(CONTENT_FIELDS.map((f) => [f, q[f]]));
  return createHash("sha256").update(stable(content)).digest("hex").slice(0, 16);
}

const normLetters = (xs) =>
  [...new Set((xs ?? []).map((x) => String(x).trim().toUpperCase()))].sort();
export const sameAnswer = (a, b) => stable(normLetters(a)) === stable(normLetters(b));

/**
 * Compare one bank at the base ref with the working tree.
 * `base` may be null when the bank is new in this piece of work.
 */
export function diffBank(base, head) {
  const before = new Map((base?.questions ?? []).map((q) => [q.id, q]));
  const after = new Map(head.questions.map((q) => [q.id, q]));
  const added = [];
  const changed = [];
  const retagged = [];
  const removed = [...before.keys()].filter((id) => !after.has(id));
  for (const [id, q] of after) {
    const old = before.get(id);
    if (!old) {
      added.push(id);
      continue;
    }
    const content = CONTENT_FIELDS.filter((f) => stable(old[f]) !== stable(q[f]));
    const tags = TAG_FIELDS.filter((f) => stable(old[f]) !== stable(q[f]));
    if (content.length) changed.push({ id, fields: [...content, ...tags] });
    else if (tags.length) retagged.push({ id, fields: tags });
  }
  return { added, changed, retagged, removed };
}

/**
 * Why a question in the diff still needs a review, or null if it doesn't.
 * `versions` holds the question at the base, at each commit since that touched
 * its bank, and in the working tree (null where it doesn't exist yet). The
 * rating is stale when the content last changed after the rating did, which
 * includes a rating carried over unchanged from the base onto edited content.
 */
export function reviewReason(versions, { all = false } = {}) {
  const head = versions.at(-1);
  if (all) return "re-review requested (--all)";
  if (!head.confidence) return "no confidence rating";
  let content = -1;
  let rating = -1;
  versions.forEach((v, i) => {
    if (!v) return;
    const prev = i ? versions[i - 1] : null;
    if (!prev || contentHash(prev) !== contentHash(v)) content = i;
    if (v.confidence && (!prev || stable(prev.confidence) !== stable(v.confidence))) rating = i;
  });
  return content > rating ? "content changed after it was last rated" : null;
}

/** Context that lintQuestion checks a question against. */
export function lintContext(bank, guide) {
  const multiIsAnalysis = /multi-select/i.test(bank.tagging_legend?.complexity?.Analysis ?? "");
  return {
    domains: bank.domain_weights ? new Set(Object.keys(bank.domain_weights)) : null,
    topics: guide ? new Set(guide.sections.map((s) => s.title)) : null,
    complexities: bank.tagging_legend?.complexity
      ? new Set(Object.keys(bank.tagging_legend.complexity))
      : null,
    multiIsAnalysis,
    questions: bank.questions,
  };
}

const tokens = (s) =>
  new Set(
    String(s)
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? [],
  );
function jaccard(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

/** Structural and quality problems with one question: [{level: "error"|"warn", message}]. */
export function lintQuestion(q, ctx) {
  const out = [];
  const error = (message) => out.push({ level: "error", message });
  const warn = (message) => out.push({ level: "warn", message });

  if (!Number.isInteger(q.id)) error("id must be an integer");
  for (const f of ["question", "explanation", "domain", "topic"]) {
    if (typeof q[f] !== "string" || !q[f].trim()) error(`${f} must be a non-empty string`);
  }
  const keys = Object.keys(q.options ?? {});
  if (stable(keys) !== stable(LETTERS))
    error(`options must be exactly A–D (got ${keys.join("") || "none"})`);
  const texts = keys.map((k) => String(q.options[k] ?? "").trim());
  if (texts.some((t) => !t)) error("every option needs text");
  if (new Set(texts.map((t) => t.toLowerCase())).size !== texts.length)
    error("two options are identical");
  const correct = Array.isArray(q.correct) ? q.correct : [];
  if (!correct.length) error("correct must list at least one letter");
  if (new Set(correct).size !== correct.length) error("correct repeats a letter");
  for (const c of correct) if (!keys.includes(c)) error(`correct letter ${c} is not an option`);
  if (correct.length >= keys.length && keys.length) error("every option is marked correct");

  if (ctx.domains && q.domain && !ctx.domains.has(q.domain))
    error(`domain "${q.domain}" is not in domain_weights`);
  if (ctx.topics && q.topic && !ctx.topics.has(q.topic)) {
    error(`topic "${q.topic}" has no study-guide section with that title`);
  }
  if (ctx.complexities && !ctx.complexities.has(q.complexity)) {
    error(`complexity "${q.complexity}" is not in tagging_legend`);
  }
  if (!["Easy", "Medium", "Hard"].includes(q.topic_difficulty)) {
    error(`topic_difficulty must be Easy, Medium or Hard`);
  }

  // Multi-select items must say how many to pick, and (in banks whose legend
  // defines it that way) be tagged Analysis.
  const word = COUNT_WORDS[correct.length];
  const askedFor = Object.entries(COUNT_WORDS).find(([, w]) =>
    new RegExp(`\\b${w}\\b`).test(q.question ?? ""),
  );
  if (correct.length > 1 && !(word && new RegExp(`\\b${word}\\b`).test(q.question ?? ""))) {
    error(
      `${correct.length} correct answers but the stem doesn't say "Select the ${word ?? correct.length} …"`,
    );
  }
  if (correct.length === 1 && askedFor)
    error(`stem asks for ${askedFor[1]} answers but only one is keyed`);
  if (ctx.multiIsAnalysis && correct.length > 1 !== (q.complexity === "Analysis")) {
    error("multi-select questions, and only those, must have complexity Analysis");
  }

  if (q.confidence !== undefined) for (const m of lintConfidence(q.confidence)) error(m);

  // Quality signals a reviewer should look at; never fatal.
  const all = `${q.question}\n${texts.join("\n")}`;
  if (/\b(all|none) of the above\b/i.test(all)) warn('avoid "all/none of the above" options');
  if (/\b(this exam|the exam guide|tested elsewhere|answer key|this domain)\b/i.test(all)) {
    warn("exam-meta wording in the stem or options means nothing to a test-taker");
  }
  if (correct.length === 1 && keys.includes(correct[0])) {
    const keyed = texts[keys.indexOf(correct[0])].length;
    const longest = Math.max(
      ...texts.filter((_, i) => keys[i] !== correct[0]).map((t) => t.length),
    );
    if (keyed > 60 && keyed > 1.8 * longest)
      warn("the keyed option is far longer than every distractor (a length tell)");
  }
  if (typeof q.explanation === "string" && q.explanation.trim().length < 40)
    warn("explanation is very short");

  // Duplicates against the rest of the bank.
  if (ctx.questions && typeof q.question === "string") {
    const mine = tokens(q.question);
    for (const other of ctx.questions) {
      if (other === q || other.id === q.id || typeof other.question !== "string") continue;
      const sim = jaccard(mine, tokens(other.question));
      const sameOptions =
        stable(Object.values(other.options ?? {}).sort()) === stable([...texts].sort());
      if (sim === 1 && sameOptions) error(`duplicate of question ${other.id}`);
      else if (sim >= 0.85) warn(`stem is nearly identical to question ${other.id}`);
    }
  }
  return out;
}

/**
 * How often the keyed option of a single-answer question is also its longest
 * option. With four options chance is 25%; far above that, "pick the longest"
 * beats knowing the material.
 */
export function longestKeyedShare(questions) {
  let longest = 0;
  let single = 0;
  for (const q of questions) {
    if (q.correct?.length !== 1 || !q.options) continue;
    single++;
    const lengths = Object.entries(q.options).map(([k, t]) => [k, String(t).length]);
    const max = Math.max(...lengths.map(([, l]) => l));
    const top = lengths.filter(([, l]) => l === max).map(([k]) => k);
    if (top.length === 1 && top[0] === q.correct[0]) longest++;
  }
  return { longest, single };
}
export const LONGEST_KEYED_WARN = 0.5;
// Bank-wide ceiling: `lint` fails, and the unit tests fail, above this share.
export const LONGEST_KEYED_MAX = 0.4;

/**
 * Where the keyed option of each single-answer question ranks by length:
 * ranks[0] counts keys no other option outlasts, ranks[1] keys with one longer
 * option, and so on. Trimming every key would just move the tell to
 * "pick the second-longest", so no rank should dominate.
 */
export function keyLengthRanks(questions) {
  const ranks = [];
  let single = 0;
  for (const q of questions) {
    if (q.correct?.length !== 1 || !q.options) continue;
    single++;
    const keyed = String(q.options[q.correct[0]] ?? "").length;
    const rank = Object.values(q.options).filter((t) => String(t).length > keyed).length;
    ranks[rank] = (ranks[rank] ?? 0) + 1;
  }
  return { ranks: Array.from(ranks, (n) => n ?? 0), single };
}

/** Schema and consistency rules for a confidence rating (mirrors the unit test). */
export function lintConfidence(c) {
  const out = [];
  if (!c || typeof c !== "object") return ["confidence must be an object"];
  if (!["green", "amber", "red"].includes(c.rag))
    out.push("confidence.rag must be green, amber or red");
  if (!LEVELS.includes(c.level)) out.push("confidence.level must be high, medium or low");
  if (!["docs", "reasoning"].includes(c.basis))
    out.push("confidence.basis must be docs or reasoning");
  if (typeof c.timeSensitive !== "boolean") out.push("confidence.timeSensitive must be a boolean");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.reviewed ?? ""))
    out.push("confidence.reviewed must be YYYY-MM-DD");
  if (c.reworded !== undefined && c.reworded !== true)
    out.push("confidence.reworded is true or absent");
  for (const u of c.sources ?? [])
    if (!ANTHROPIC_DOCS.test(u)) out.push(`confidence source is not Anthropic docs: ${u}`);
  if (c.rag === "green" && !(c.level === "high" && c.basis === "docs" && c.sources?.length)) {
    out.push("green needs high confidence, a docs basis and at least one source");
  }
  if (c.level === "low" && c.rag !== "red") out.push("low confidence must be red");
  if (c.basis === "docs" && !c.sources?.length) out.push("a docs basis needs sources");
  return out;
}

/** What a reviewer sees: no key, no explanation, no rating, no topic. */
export function blindItem(bank, q) {
  return { bank, id: q.id, select: q.correct.length, question: q.question, options: q.options };
}

/** Validates one reviewer answer; returns a list of problems. */
export function checkAnswer(a) {
  const out = [];
  if (!Array.isArray(a.answer) || !a.answer.length) out.push("answer must list letters");
  if (!LEVELS.includes(a.confidence)) out.push("confidence must be high, medium or low");
  if (!["verified", "reasoning", "reasoned"].includes(a.basis)) {
    out.push("basis must be verified or reasoning");
  }
  return out;
}

/** Why a reviewed item needs adjudication (empty when it doesn't). */
export function flagReasons(q, a) {
  const reasons = [];
  if (!sameAnswer(a.answer, q.correct)) reasons.push("disagree");
  if (a.confidence === "low") reasons.push("low-confidence");
  if (a.issues && String(a.issues).trim()) reasons.push("issue");
  if (sameAnswer(a.answer, q.correct) && a.also_defensible?.length)
    reasons.push("other-defensible");
  return reasons;
}

const ALLOWED_PATCH = new Set(CONTENT_FIELDS);
/** Applies an adjudication patch to a copy of the question. */
export function applyPatch(q, patch) {
  if (!patch) return q;
  const bad = Object.keys(patch).filter((k) => !ALLOWED_PATCH.has(k));
  if (bad.length)
    throw new Error(
      `question ${q.id}: patch may only touch ${CONTENT_FIELDS.join(", ")} (got ${bad.join(", ")})`,
    );
  const next = { ...q, ...patch };
  if (patch.options) next.options = { ...q.options, ...patch.options };
  if (patch.correct) next.correct = normLetters(patch.correct);
  return next;
}

/**
 * Turns a blind answer (and, for flagged items, an adjudication verdict) into a
 * confidence rating. The rules match tests/unit/question-confidence-data.test.mjs:
 *   green = matched blind, high confidence, docs basis with sources
 *   amber = matched, but judgement-based or medium confidence
 *   red   = disputed, or a disagreement / low confidence nobody resolved
 */
export function deriveConfidence({ key, answer, verdict, date, prior }) {
  const agreed = sameAnswer(answer.answer, key);
  let level = LEVELS.includes(answer.confidence) ? answer.confidence : "low";
  const sources = [...new Set([...(answer.sources ?? []), ...(verdict?.sources ?? [])])].filter(
    (u) => ANTHROPIC_DOCS.test(u),
  );
  // The adjudicator's sources only count when they settled a disagreement or
  // low confidence; they don't turn the reviewer's judgement call into a
  // documented fact.
  const settled = verdict && verdict.verdict !== "dispute" && (!agreed || level === "low");
  const docsBacked = answer.basis === "verified" || (settled && verdict.sources?.length);
  const basis = docsBacked && sources.length ? "docs" : "reasoning";
  let unresolved = false;

  if (verdict?.verdict === "dispute") level = "low";
  else if (!agreed || level === "low") {
    // An adjudicator who kept, fixed or re-keyed the question resolved the
    // doubt, but a reviewer still disagreed or was unsure, so cap at medium.
    if (verdict) level = "medium";
    else {
      level = "low";
      unresolved = true;
    }
  }

  const rag = level === "low" ? "red" : level === "high" && basis === "docs" ? "green" : "amber";
  const reworded =
    Boolean(verdict?.patch && Object.keys(verdict.patch).length) || prior?.reworded === true;
  const confidence = {
    rag,
    level,
    basis,
    timeSensitive: Boolean(verdict?.time_sensitive ?? answer.time_sensitive ?? false),
    reviewed: date,
    ...(reworded ? { reworded: true } : {}),
    ...(sources.length ? { sources } : {}),
  };
  return { confidence, unresolved };
}

/** Recomputes the bank-level counts that new or removed questions make stale. */
export function refreshMeta(bank) {
  const n = bank.questions.length;
  const next = { ...bank };
  if ("total_questions" in bank) next.total_questions = n;
  if (bank.domain_weights || bank.actual_domain_distribution) {
    const domains = Object.keys(bank.domain_weights ?? bank.actual_domain_distribution);
    for (const q of bank.questions) if (!domains.includes(q.domain)) domains.push(q.domain);
    next.actual_domain_distribution = Object.fromEntries(
      domains.map((d) => [
        d,
        n ? Math.round((bank.questions.filter((q) => q.domain === d).length / n) * 1e4) / 1e4 : 0,
      ]),
    );
  }
  return next;
}

/** New questions use 20000 + id (the convention in the CCDV-F bank) unless that's taken. */
export function fillSourceIds(questions) {
  const used = new Set(questions.map((q) => q.source_id).filter((x) => x != null));
  let max = Math.max(0, ...used);
  return questions.map((q) => {
    if (q.source_id != null) return q;
    let sid = 20000 + q.id;
    if (used.has(sid)) sid = ++max;
    used.add(sid);
    max = Math.max(max, sid);
    // Keep the rating last, where every other question has it.
    const { confidence, ...rest } = q;
    return { ...rest, source_id: sid, ...(confidence ? { confidence } : {}) };
  });
}

// --- weak-topic keyword matching (mirrors src/features/study/lib/topics.ts) ---
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function buildPattern(keywords, caseInsensitive = true) {
  if (!keywords.length) return null;
  const alternation = keywords
    .map(escapeRegex)
    .sort((a, b) => b.length - a.length)
    .join("|");
  return new RegExp(
    `(?:^|[^A-Za-z0-9])(?:${alternation})(?:[^A-Za-z0-9]|$)`,
    caseInsensitive ? "i" : undefined,
  );
}
export const haystack = (q) =>
  [q.question, ...Object.values(q.options ?? {}), q.explanation].join("\n");

const STOP = new Set(
  `a an and are as at be but by can do does for from has have how i if in into is it its may more most must no not of on
  only or other should so than that the their them then there these they this to use used uses using was what when where
  which while who why will with would you your which each both all any one two three via per within without about after
  before between over under same such very can't don't doesn't isn't instead rather best better option options answer
  question correct true false following select team teams need needs want wants make makes`.split(
    /\s+/,
  ),
);

function candidatePhrases(text) {
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").toLowerCase())
    .filter(Boolean);
  const out = new Set();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n);
      if (STOP.has(gram[0]) || STOP.has(gram.at(-1))) continue;
      if (gram.every((w) => /^\d+$/.test(w))) continue;
      if (n === 1 && gram[0].length < 5) continue;
      out.add(gram.join(" "));
    }
  }
  return out;
}

/**
 * For questions in scope whose topic's keywords don't match them, propose
 * keywords that match them and no question filed under any other topic.
 * Returns [{topic, unmatched: [ids], add: [{keyword, covers: [ids]}], stillUnmatched: [ids]}].
 */
export function suggestKeywords(bank, guide, scopeIds, { maxPerTopic = 4 } = {}) {
  const sections = new Map(guide.sections.map((s) => [s.title, s]));
  const scope = new Set(scopeIds ?? bank.questions.map((q) => q.id));
  const hay = new Map(bank.questions.map((q) => [q.id, haystack(q)]));
  const byTopic = new Map();
  for (const q of bank.questions) {
    if (!scope.has(q.id)) continue;
    const s = sections.get(q.topic);
    if (!s) continue; // lint reports the missing section
    const pat = buildPattern(s.keywords ?? []);
    if (pat && pat.test(hay.get(q.id))) continue;
    if (!byTopic.has(q.topic)) byTopic.set(q.topic, []);
    byTopic.get(q.topic).push(q);
  }

  const results = [];
  for (const [topic, unmatched] of byTopic) {
    const others = bank.questions.filter((q) => q.topic !== topic).map((q) => hay.get(q.id));
    const own = bank.questions.filter((q) => q.topic === topic);
    const existing = new Set((sections.get(topic).keywords ?? []).map((k) => k.toLowerCase()));
    const cands = [];
    const seen = new Set();
    for (const q of unmatched) {
      for (const phrase of candidatePhrases(hay.get(q.id))) {
        if (seen.has(phrase) || existing.has(phrase)) continue;
        seen.add(phrase);
        const pat = buildPattern([phrase]);
        if (others.some((h) => pat.test(h))) continue; // would flag another topic
        const covers = unmatched.filter((u) => pat.test(hay.get(u.id))).map((u) => u.id);
        if (!covers.length) continue;
        const reach = own.filter((o) => pat.test(hay.get(o.id))).length;
        cands.push({ keyword: phrase, covers, reach, words: phrase.split(" ").length });
      }
    }
    const left = new Set(unmatched.map((q) => q.id));
    const add = [];
    while (left.size && add.length < maxPerTopic) {
      let best = null;
      for (const c of cands) {
        const gain = c.covers.filter((id) => left.has(id)).length;
        if (!gain) continue;
        const score = [gain, c.reach, -Math.abs(c.words - 2), c.keyword.length];
        if (!best || cmp(score, best.score) > 0) best = { c, score };
      }
      if (!best) break;
      add.push({ keyword: best.c.keyword, covers: best.c.covers });
      for (const id of best.c.covers) left.delete(id);
    }
    results.push({ topic, unmatched: unmatched.map((q) => q.id), add, stillUnmatched: [...left] });
  }
  return results;
}
function cmp(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

function git(root, args, opts = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).trim();
}

export function resolveBase(root, ref) {
  if (ref) return { ref, sha: git(root, ["rev-parse", "--verify", `${ref}^{commit}`]) };
  for (const candidate of ["origin/main", "main"]) {
    try {
      return {
        ref: `merge-base(HEAD, ${candidate})`,
        sha: git(root, ["merge-base", "HEAD", candidate]),
      };
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    "couldn't find origin/main or main; pass --base <ref> (fetch the base branch first)",
  );
}

async function listBanks(root) {
  const dir = path.join(root, SOURCES_REL);
  return (await readdir(dir))
    .filter((f) => f.endsWith("_practice_questions.json"))
    .sort()
    .map((f) => ({
      prefix: f.replace(/_practice_questions\.json$/, ""),
      file: path.join(dir, f),
      rel: `${SOURCES_REL}/${f}`,
    }));
}

async function loadGuide(root, prefix) {
  const p = path.join(root, SOURCES_REL, `${prefix}_study_guide.json`);
  return existsSync(p) ? { path: p, data: await readJson(p) } : null;
}

function bankAt(root, sha, rel) {
  try {
    return JSON.parse(git(root, ["show", `${sha}:${rel}`], { maxBuffer: 64 * 1024 * 1024 }));
  } catch {
    return null; // the bank doesn't exist at the base
  }
}

/** A path relative to the repo when it's inside it, absolute otherwise. */
function shown(root, p) {
  const rel = path.relative(root, p);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : p;
}

function revList(root, base, rel) {
  try {
    const out = git(root, ["rev-list", "--reverse", `${base}..HEAD`, "--", rel]);
    return out ? out.split("\n") : [];
  } catch {
    return [];
  }
}

/** Writes JSON formatted the way the repo's prettier config would. */
async function writeFormatted(file, value) {
  let text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const prettier = await import("prettier");
    const config = (await prettier.resolveConfig(file)) ?? {};
    text = await prettier.format(text, { ...config, filepath: file });
  } catch {
    // prettier unavailable: JSON.stringify output is still valid
  }
  await writeFile(file, text);
}

/** Everything the subcommands need about the current piece of work. */
export async function collect(root, { base, all = false } = {}) {
  const b = resolveBase(root, base);
  const banks = [];
  for (const bank of await listBanks(root)) {
    const head = await readJson(bank.file);
    const baseData = bankAt(root, b.sha, bank.rel);
    const guide = await loadGuide(root, bank.prefix);
    const d = diffBank(baseData, head);
    // Every committed version of the bank since the base, oldest first, so a
    // rating made earlier in the same piece of work is checked against later edits.
    const commits = d.added.length || d.changed.length ? revList(root, b.sha, bank.rel) : [];
    const history = [baseData, ...commits.map((sha) => bankAt(root, sha, bank.rel)), head].map(
      (v) => new Map((v?.questions ?? []).map((q) => [q.id, q])),
    );
    const byId = new Map(head.questions.map((q) => [q.id, q]));
    const ctx = lintContext(head, guide?.data);
    const items = [
      ...d.added.map((id) => ({ id, status: "added", fields: [] })),
      ...d.changed.map((c) => ({ id: c.id, status: "changed", fields: c.fields })),
    ].map((it) => {
      const q = byId.get(it.id);
      return {
        ...it,
        reason: reviewReason(
          history.map((v) => v.get(it.id) ?? null),
          { all },
        ),
        problems: lintQuestion(q, ctx),
        hash: contentHash(q),
      };
    });
    const idCounts = new Map();
    for (const q of head.questions) idCounts.set(q.id, (idCounts.get(q.id) ?? 0) + 1);
    const bankProblems = [...idCounts]
      .filter(([, c]) => c > 1)
      .map(([id, c]) => `id ${id} is used ${c} times`);
    const sids = head.questions.map((q) => q.source_id).filter((x) => x != null);
    if (new Set(sids).size !== sids.length) bankProblems.push("source_id values are not unique");
    const lengthTell = longestKeyedShare(items.map((it) => byId.get(it.id)));
    banks.push({ ...bank, head, guide, base: baseData, diff: d, items, bankProblems, lengthTell });
  }
  let head = null;
  let dirty = false;
  try {
    head = git(root, ["rev-parse", "HEAD"]);
    dirty = git(root, ["status", "--porcelain", "--", SOURCES_REL]) !== "";
  } catch {
    // not a git checkout
  }
  return { base: b, head: { sha: head, dirty }, banks };
}

function printDiff(state, { verbose = false } = {}) {
  console.log(
    `Base: ${state.base.ref} (${state.base.sha.slice(0, 7)})  Head: ${state.head.sha?.slice(0, 7) ?? "?"}${state.head.dirty ? " + uncommitted edits" : ""}`,
  );
  let errors = 0;
  for (const b of state.banks) {
    const pending = b.items.filter((i) => i.reason);
    const errs = b.items.flatMap((i) => i.problems.filter((p) => p.level === "error"));
    const warns = b.items.flatMap((i) => i.problems.filter((p) => p.level === "warn"));
    errors += errs.length + b.bankProblems.length;
    console.log(
      `\n${b.prefix}: +${b.diff.added.length} added, ~${b.diff.changed.length} changed, ${b.diff.retagged.length} retagged, -${b.diff.removed.length} removed | ${pending.length} need review | ${errs.length} lint errors, ${warns.length} warnings`,
    );
    for (const p of b.bankProblems) console.log(`  ERROR bank: ${p}`);
    const { longest, single } = b.lengthTell;
    if (single && longest / single > LONGEST_KEYED_WARN) {
      console.log(
        `  WARN: the keyed option is the longest in ${longest}/${single} single-answer questions in scope (chance is 25%); lengthen distractors or trim keys`,
      );
    }
    for (const it of b.items) {
      const show =
        it.reason ||
        it.problems.some((p) => p.level === "error") ||
        (verbose && it.problems.length);
      if (!show) continue;
      console.log(
        `  #${it.id} ${it.status}${it.fields.length ? ` (${it.fields.join(", ")})` : ""}${it.reason ? ` — needs review: ${it.reason}` : ""}`,
      );
      for (const p of it.problems)
        if (p.level === "error" || verbose)
          console.log(`    ${p.level.toUpperCase()}: ${p.message}`);
    }
    if (b.diff.removed.length) console.log(`  removed ids: ${b.diff.removed.join(", ")}`);
  }
  return errors;
}

async function cmdPrepare(root, opts) {
  const state = await collect(root, opts);
  const errors = printDiff(state);
  if (errors) {
    console.error("\nFix the lint errors above before preparing a review.");
    return 1;
  }
  const out = path.resolve(root, opts.out ?? DEFAULT_OUT_REL);
  await rm(out, { recursive: true, force: true });
  for (const d of ["blind", "answers", "adjudicate", "verdicts"])
    await mkdir(path.join(out, d), { recursive: true });
  const items = state.banks.flatMap((b) =>
    b.items
      .filter((i) => i.reason)
      .map((i) => ({
        bank: b.prefix,
        rel: b.rel,
        id: i.id,
        status: i.status,
        reason: i.reason,
        hash: i.hash,
      })),
  );
  const size = Math.max(1, Number(opts.batchSize ?? 15));
  const batches = [];
  for (let i = 0; i < items.length; i += size) {
    const name = `batch-${String(batches.length + 1).padStart(2, "0")}.json`;
    const chunk = items.slice(i, i + size).map((it) => {
      const bank = state.banks.find((b) => b.prefix === it.bank);
      return blindItem(
        it.bank,
        bank.head.questions.find((q) => q.id === it.id),
      );
    });
    await writeFile(path.join(out, "blind", name), `${JSON.stringify(chunk, null, 2)}\n`);
    batches.push(name);
  }
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    base: state.base,
    head: state.head,
    items,
    batches,
  };
  await writeFile(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `\n${items.length} question(s) to review in ${batches.length} blind batch(es) under ${shown(root, out)}/blind`,
  );
  return 0;
}

async function readDirJson(dir) {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const all = [];
  for (const f of files) {
    const data = await readJson(path.join(dir, f));
    for (const x of Array.isArray(data) ? data : [data]) all.push({ ...x, _file: f });
  }
  return all;
}
const keyOf = (bank, id) => `${bank}#${id}`;

async function loadReview(root, opts) {
  const out = path.resolve(root, opts.out ?? DEFAULT_OUT_REL);
  const manifestPath = path.join(out, "manifest.json");
  if (!existsSync(manifestPath))
    throw new Error(`no manifest at ${manifestPath}; run prepare first`);
  const manifest = await readJson(manifestPath);
  const banks = new Map();
  for (const it of manifest.items) {
    if (!banks.has(it.bank))
      banks.set(it.bank, {
        file: path.join(root, it.rel),
        data: await readJson(path.join(root, it.rel)),
      });
  }
  const answers = new Map();
  const answerProblems = [];
  for (const a of await readDirJson(path.join(out, "answers"))) {
    const bank = a.bank ?? (banks.size === 1 ? [...banks.keys()][0] : undefined);
    const problems = checkAnswer(a);
    if (problems.length) answerProblems.push(`${a._file} #${a.id}: ${problems.join("; ")}`);
    else answers.set(keyOf(bank, a.id), { ...a, bank });
  }
  const verdicts = new Map();
  for (const v of await readDirJson(path.join(out, "verdicts"))) {
    const bank = v.bank ?? (banks.size === 1 ? [...banks.keys()][0] : undefined);
    if (!VERDICTS.includes(v.verdict))
      throw new Error(`${v._file} #${v.id}: verdict must be one of ${VERDICTS.join(", ")}`);
    if (v.verdict === "rekey" && !v.patch?.correct)
      throw new Error(`${v._file} #${v.id}: a rekey verdict needs patch.correct`);
    verdicts.set(keyOf(bank, v.id), v);
  }
  return { out, manifest, banks, answers, answerProblems, verdicts };
}

async function cmdCompare(root, opts) {
  const r = await loadReview(root, opts);
  for (const p of r.answerProblems) console.error(`invalid answer: ${p}`);
  const flagged = [];
  const missing = [];
  let agree = 0;
  for (const it of r.manifest.items) {
    const q = r.banks.get(it.bank).data.questions.find((x) => x.id === it.id);
    const a = r.answers.get(keyOf(it.bank, it.id));
    if (!q) throw new Error(`${it.bank}#${it.id} is no longer in the bank; re-run prepare`);
    if (!a) {
      missing.push(keyOf(it.bank, it.id));
      continue;
    }
    if (sameAnswer(a.answer, q.correct)) agree++;
    const reasons = flagReasons(q, a);
    if (reasons.length) {
      flagged.push({
        bank: it.bank,
        id: q.id,
        reasons,
        domain: q.domain,
        topic: q.topic,
        question: q.question,
        options: q.options,
        key: q.correct,
        explanation: q.explanation,
        reviewer_answer: a.answer,
        reviewer_confidence: a.confidence,
        reviewer_also_defensible: a.also_defensible ?? [],
        reviewer_issues: a.issues ?? "",
        reviewer_sources: a.sources ?? [],
      });
    }
  }
  await rm(path.join(r.out, "adjudicate"), { recursive: true, force: true });
  await mkdir(path.join(r.out, "adjudicate"), { recursive: true });
  const size = Math.max(1, Number(opts.batchSize ?? 15));
  for (let i = 0; i < flagged.length; i += size) {
    const name = `batch-${String(i / size + 1).padStart(2, "0")}.json`;
    await writeFile(
      path.join(r.out, "adjudicate", name),
      `${JSON.stringify(flagged.slice(i, i + size), null, 2)}\n`,
    );
  }
  await writeFile(path.join(r.out, "flagged.json"), `${JSON.stringify(flagged, null, 2)}\n`);
  const answered = r.manifest.items.length - missing.length;
  console.log(
    `Reviewed ${answered}/${r.manifest.items.length}; ${agree} matched the key; ${flagged.length} flagged for adjudication.`,
  );
  const counts = {};
  for (const f of flagged) for (const x of f.reasons) counts[x] = (counts[x] ?? 0) + 1;
  if (flagged.length)
    console.log(
      `Flag reasons: ${Object.entries(counts)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")}`,
    );
  if (missing.length) console.log(`Missing answers: ${missing.join(", ")}`);
  return missing.length || r.answerProblems.length ? 1 : 0;
}

async function cmdApply(root, opts) {
  const r = await loadReview(root, opts);
  if (r.answerProblems.length) {
    for (const p of r.answerProblems) console.error(`invalid answer: ${p}`);
    return 1;
  }
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date must be YYYY-MM-DD");
  const summary = [];
  const unresolved = [];
  const missing = [];
  const updated = new Map();
  for (const [bankName, bank] of r.banks) {
    const items = r.manifest.items.filter((i) => i.bank === bankName);
    const questions = bank.data.questions.map((q) => {
      const it = items.find((i) => i.id === q.id);
      if (!it) return q;
      if (contentHash(q) !== it.hash) {
        throw new Error(
          `${bankName}#${q.id} changed after prepare; re-run prepare and review it again`,
        );
      }
      const answer = r.answers.get(keyOf(bankName, q.id));
      if (!answer) {
        missing.push(keyOf(bankName, q.id));
        return q;
      }
      const verdict = r.verdicts.get(keyOf(bankName, q.id));
      const reasons = flagReasons(q, answer);
      const needsVerdict = reasons.includes("disagree") || reasons.includes("low-confidence");
      const next =
        verdict?.verdict === "fix" || verdict?.verdict === "rekey"
          ? applyPatch(q, verdict.patch)
          : q;
      const { confidence, unresolved: open } = deriveConfidence({
        key: q.correct,
        answer,
        verdict: needsVerdict || verdict ? verdict : undefined,
        date,
        prior: q.confidence,
      });
      if (open) unresolved.push(keyOf(bankName, q.id));
      summary.push({
        bank: bankName,
        id: q.id,
        status: it.status,
        verdict: verdict?.verdict ?? null,
        ...confidence,
      });
      return { ...next, confidence };
    });
    updated.set(bankName, {
      ...bank,
      data: refreshMeta({ ...bank.data, questions: fillSourceIds(questions) }),
    });
  }
  if (missing.length) {
    console.error(
      `No reviewer answer for: ${missing.join(", ")}. Review them (or re-run prepare) before applying.`,
    );
    return 1;
  }
  if (unresolved.length && !opts.allowUnresolved) {
    console.error(
      `Unresolved disagreement or low confidence for: ${unresolved.join(", ")}. Add a verdict for each (see adjudicate/), or pass --allow-unresolved to rate them red.`,
    );
    return 1;
  }
  // Re-lint what we're about to write, so a bad patch can't land.
  for (const [bankName, bank] of updated) {
    const guide = await loadGuide(root, bankName);
    const ctx = lintContext(bank.data, guide?.data);
    for (const it of r.manifest.items.filter((i) => i.bank === bankName)) {
      const q = bank.data.questions.find((x) => x.id === it.id);
      const errs = lintQuestion(q, ctx).filter((p) => p.level === "error");
      if (errs.length)
        throw new Error(
          `${bankName}#${it.id} fails lint after patching: ${errs.map((e) => e.message).join("; ")}`,
        );
    }
  }
  for (const bank of updated.values()) await writeFormatted(bank.file, bank.data);

  const tally = { green: 0, amber: 0, red: 0 };
  for (const s of summary) tally[s.rag]++;
  const lines = [
    `# Question review — ${date}`,
    "",
    `Base ${r.manifest.base.ref} (${r.manifest.base.sha.slice(0, 7)}). ${summary.length} question(s) rated: 🟢 ${tally.green} · 🟠 ${tally.amber} · 🔴 ${tally.red}.`,
    "",
    "| Question | Status | Verdict | RAG | Level | Basis | Recently changed | Reworded |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summary.map(
      (s) =>
        `| ${s.bank}#${s.id} | ${s.status} | ${s.verdict ?? "—"} | ${s.rag} | ${s.level} | ${s.basis} | ${s.timeSensitive ? "yes" : ""} | ${s.reworded ? "yes" : ""} |`,
    ),
    "",
  ];
  await writeFile(path.join(r.out, "summary.md"), lines.join("\n"));
  await writeFile(
    path.join(r.out, "summary.json"),
    `${JSON.stringify({ date, tally, items: summary }, null, 2)}\n`,
  );
  console.log(
    `Rated ${summary.length}: green ${tally.green}, amber ${tally.amber}, red ${tally.red}. Updated ${[...updated.keys()].join(", ")}; summary in ${shown(root, r.out)}/summary.md`,
  );
  console.log("Next: npm run parse && npm run check-data && npm test && npm run report");
  return 0;
}

async function cmdKeywords(root, opts) {
  const state = await collect(root, opts);
  let left = 0;
  for (const b of state.banks) {
    if (!b.guide) continue;
    const scope = opts.all ? null : b.items.map((i) => i.id);
    if (scope && !scope.length) continue;
    const res = suggestKeywords(b.head, b.guide.data, scope);
    if (!res.length) {
      console.log(`${b.prefix}: every question in scope already maps to its topic.`);
      continue;
    }
    for (const t of res) {
      console.log(`${b.prefix} · ${t.topic}: unmatched #${t.unmatched.join(", #")}`);
      for (const a of t.add) console.log(`  + "${a.keyword}" (covers #${a.covers.join(", #")})`);
      if (t.stillUnmatched.length)
        console.log(`  ! no pure keyword for #${t.stillUnmatched.join(", #")}: add one by hand`);
      left += t.stillUnmatched.length;
    }
    if (opts.write) {
      const guide = structuredClone(b.guide.data);
      for (const t of res) {
        const s = guide.sections.find((x) => x.title === t.topic);
        s.keywords = [...new Set([...(s.keywords ?? []), ...t.add.map((a) => a.keyword)])];
      }
      await writeFormatted(b.guide.path, guide);
      console.log(
        `  wrote ${res.reduce((n, t) => n + t.add.length, 0)} keyword(s) to ${path.relative(root, b.guide.path)}`,
      );
    }
  }
  if (opts.write) console.log("Next: npm run parse && npm run check-data");
  return left ? 1 : 0;
}

async function cmdLint(root, opts) {
  let errors = 0;
  for (const bank of await listBanks(root)) {
    const data = await readJson(bank.file);
    const guide = await loadGuide(root, bank.prefix);
    const ctx = lintContext(data, guide?.data);
    for (const q of data.questions) {
      for (const p of lintQuestion(q, ctx)) {
        if (p.level === "error") errors++;
        if (p.level === "error" || opts.verbose)
          console.log(`${bank.prefix}#${q.id} ${p.level.toUpperCase()}: ${p.message}`);
      }
    }
    const { longest, single } = longestKeyedShare(data.questions);
    if (single && longest / single > LONGEST_KEYED_MAX) {
      errors++;
      console.log(
        `${bank.prefix} ERROR: the keyed option is the longest in ${longest}/${single} single-answer questions (max ${LONGEST_KEYED_MAX * 100}%, chance is 25%); lengthen distractors or trim keys`,
      );
    } else if (opts.verbose && single) {
      console.log(
        `${bank.prefix}: the keyed option is the longest in ${longest}/${single} single-answer questions (${Math.round((longest / single) * 100)}%)`,
      );
    }
  }
  console.log(errors ? `${errors} lint error(s).` : "No lint errors.");
  return errors ? 1 : 0;
}

export function parseArgs(argv) {
  const [command = "diff", ...rest] = argv;
  const opts = {};
  const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  for (let i = 0; i < rest.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(rest[i]);
    if (!m) throw new Error(`unexpected argument ${rest[i]}`);
    const [, name, inline] = m;
    const valued = ["base", "out", "batch-size", "date", "root"].includes(name);
    opts[camel(name)] = valued ? (inline ?? rest[++i]) : true;
  }
  return { command, opts };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, opts } = parseArgs(argv);
  const root = path.resolve(opts.root ?? REPO_ROOT);
  switch (command) {
    case "diff": {
      const state = await collect(root, opts);
      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              base: state.base,
              head: state.head,
              banks: state.banks.map((b) => ({
                bank: b.prefix,
                diff: b.diff,
                items: b.items,
                bankProblems: b.bankProblems,
              })),
            },
            null,
            2,
          ),
        );
        return state.banks.some(
          (b) =>
            b.bankProblems.length ||
            b.items.some((i) => i.problems.some((p) => p.level === "error")),
        )
          ? 1
          : 0;
      }
      return printDiff(state, opts) ? 1 : 0;
    }
    case "prepare":
      return cmdPrepare(root, opts);
    case "compare":
      return cmdCompare(root, opts);
    case "apply":
      return cmdApply(root, opts);
    case "keywords":
      return cmdKeywords(root, opts);
    case "lint":
      return cmdLint(root, opts);
    default:
      throw new Error(
        `unknown command "${command}" (diff, prepare, compare, apply, keywords, lint)`,
      );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`review-questions: ${err.message}`);
      process.exit(2);
    },
  );
}
