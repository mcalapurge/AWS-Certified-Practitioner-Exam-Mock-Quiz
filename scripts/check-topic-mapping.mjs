#!/usr/bin/env node
// Accuracy check for the "weak topic" study-guide mapping.
//
// The weak-topic section is populated only by keyword matching: when a quiz
// answer is wrong, mapQuestionToTopics (src/features/study/lib/topics.ts)
// regex-matches the question text against every topic's `keywords` and flags
// the topics that hit. If the keywords don't appear in the question text, a
// wrong answer contributes NOTHING to the weak-topic section — or worse, gets
// filed under the wrong topic.
//
// This script measures how well that mapping works, using ground truth that
// only the *source* question files carry: each prebuilt (Claude) exam question
// in scripts/sources/*_practice_questions.json has an exact `topic` field that
// maps 1:1 to a study-guide topic title. For every question we compute the
// mapped topics (via the app's exact regex) and compare to that true topic:
//
//   correct    — the true topic is among the flagged topics (good)
//   wrong-only  — topics were flagged but NOT the true one (mislabeled; bad)
//   zero        — nothing flagged (wrong answer lost from the weak-topic section)
//   extra-flag  — correct, but also flagged 1+ other topic (minor noise)
//
// AWS exams have no per-question topic tag (their `examSet` is just the source
// filename), so they can't be checked this way and are skipped.
//
// Usage:
//   node scripts/check-topic-mapping.mjs                 # all checkable exams
//   node scripts/check-topic-mapping.mjs <examId>        # just one
//   node scripts/check-topic-mapping.mjs --verbose       # per-topic table + question ids
//   node scripts/check-topic-mapping.mjs --min-correct=90 --max-wrong=2
//
// Exit code is non-zero if any exam falls below the thresholds, so it doubles
// as a regression gate after editing keywords or adding an exam.

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sourcesDir = path.join(repoRoot, "scripts", "sources");
const studyDataDir = path.join(repoRoot, "src", "features", "study", "data");
const quizDataDir = path.join(repoRoot, "src", "features", "quiz", "data");

// ---- CLI args ----
const args = process.argv.slice(2);
const flags = new Map(
  args.filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const onlyExam = args.find((a) => !a.startsWith("--")) ?? null;
const VERBOSE = flags.has("verbose");
const MIN_CORRECT = Number(flags.get("min-correct") ?? 90); // % of questions whose true topic is flagged
const MAX_WRONG = Number(flags.get("max-wrong") ?? 2); // % of questions mapped only to wrong topic(s)

const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

// ---------------------------------------------------------------------------
// The matcher below MUST mirror src/features/study/lib/topics.ts. If that file
// changes, update this (the self-check in main() warns if it looks out of sync).
// ---------------------------------------------------------------------------
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function buildPattern(keywords, caseInsensitive) {
  if (!keywords.length) return null;
  const alternation = keywords
    .map(escapeRegex)
    .sort((a, b) => b.length - a.length) // longer first to prefer specific match
    .join("|");
  return new RegExp(
    `(?:^|[^A-Za-z0-9])(?:${alternation})(?:[^A-Za-z0-9]|$)`,
    caseInsensitive ? "i" : undefined
  );
}
function haystackOf(q) {
  return [q.stem, ...q.options.map((o) => o.text), q.explanation].join("\n");
}

// Pair each source study guide with its sibling question bank and the exam's
// generated data. Returns null for exams that can't be checked.
async function discoverExams() {
  if (!existsSync(sourcesDir)) return [];
  const files = (await readdir(sourcesDir)).filter((f) => f.endsWith("_study_guide.json"));
  const meta = await readJson(path.join(quizDataDir, "meta.json"));
  const exams = [];
  for (const sg of files.sort()) {
    const prefix = sg.replace(/_study_guide\.json$/, "");
    const qFile = path.join(sourcesDir, `${prefix}_practice_questions.json`);
    if (!existsSync(qFile)) continue;
    const guide = await readJson(path.join(sourcesDir, sg));
    const examId = guide.examId;
    const m = meta[examId];
    if (!m) continue;
    const shipped = path.join(quizDataDir, m.provider, `${examId}.json`);
    if (!existsSync(shipped)) continue;
    exams.push({ examId, provider: m.provider, examName: m.examName, qFile, shipped });
  }
  return exams;
}

function analyze(exam, topicIndex, sourceQuestions, shippedQuestions) {
  const idx = topicIndex.filter((t) => t.examId === exam.examId);
  const titleToId = new Map(idx.map((t) => [t.title, t.id]));
  const idToTitle = new Map(idx.map((t) => [t.id, t.title]));
  const caseInsensitive = exam.provider === "claude";
  const compiled = idx.map((t) => ({ t, pattern: buildPattern(t.keywords, caseInsensitive) }));

  const map = (q) => {
    const hay = haystackOf(q);
    const m = [];
    for (const { t, pattern } of compiled) if (pattern && pattern.test(hay)) m.push(t.id);
    return m;
  };

  // Keyed by the source question's `id` field, which buildPrebuiltQuestions
  // stores as `number` in the shipped output. Index-based alignment is fragile
  // if question order ever diverges between source and generated output.
  const shippedByNum = new Map(shippedQuestions.map((q) => [q.number, q]));

  const N = sourceQuestions.length;
  const per = new Map(idx.map((t) => [t.id, { n: 0, hit: 0 }]));
  const fpCount = new Map();
  let correct = 0, wrongOnly = 0, zero = 0, extraFlag = 0;
  const wrongList = [], zeroList = [], missingTopic = new Set();

  for (let k = 0; k < N; k++) {
    const sq = sourceQuestions[k];
    const shipped = shippedByNum.get(sq?.id);
    if (!shipped) continue; // question was dropped during normalisation
    const trueTitle = sq?.topic;
    const tid = titleToId.get(trueTitle);
    if (!tid) { missingTopic.add(trueTitle ?? "(no topic field)"); continue; }
    per.get(tid).n++;
    const mapped = map(shipped);
    if (mapped.length === 0) { zero++; zeroList.push({ num: shipped.number, topic: trueTitle }); continue; }
    if (mapped.includes(tid)) {
      correct++; per.get(tid).hit++;
      if (mapped.length > 1) extraFlag++;
    } else {
      wrongOnly++;
      wrongList.push({ num: shipped.number, topic: trueTitle, mapped: mapped.map((id) => idToTitle.get(id)) });
    }
    for (const m of mapped) if (m !== tid) fpCount.set(m, (fpCount.get(m) || 0) + 1);
  }

  const checked = correct + wrongOnly + zero;
  return { idx, per, idToTitle, fpCount, N, checked, correct, wrongOnly, zero, extraFlag, wrongList, zeroList, missingTopic };
}

function pct(a, b) {
  return b ? ((100 * a) / b).toFixed(1) : "0.0";
}

async function main() {
  // Soft self-check: warn if topics.ts no longer looks like what we mirror.
  const topicsTs = path.join(studyDataDir, "..", "lib", "topics.ts");
  if (existsSync(topicsTs)) {
    const txt = await readFile(topicsTs, "utf8");
    const hasPattern = txt.includes("(?:^|[^A-Za-z0-9])");
    const hasClaudeRule = txt.includes('provider === "claude"');
    if (!hasPattern || !hasClaudeRule) {
      console.warn(
        "⚠️  topics.ts no longer matches this checker's assumptions " +
          "(regex template or the claude case-insensitivity rule changed). " +
          "Re-sync buildPattern/haystackOf in scripts/check-topic-mapping.mjs.\n"
      );
    }
  }

  const topicIndex = await readJson(path.join(studyDataDir, "topic-index.json"));
  let exams = await discoverExams();
  if (onlyExam) exams = exams.filter((e) => e.examId === onlyExam);

  if (!exams.length) {
    console.error(
      onlyExam
        ? `No checkable exam "${onlyExam}" (needs scripts/sources/<prefix>_practice_questions.json with a per-question "topic" field).`
        : "No checkable exams found. Prebuilt Claude exams carry per-question topic tags; AWS exams don't."
    );
    process.exit(1);
  }

  let anyFail = false;
  for (const exam of exams) {
    const source = await readJson(exam.qFile);
    const sourceQuestions = source.questions ?? source;
    const shipped = (await readJson(exam.shipped)).questions;

    if (!sourceQuestions[0] || typeof sourceQuestions[0].topic !== "string") {
      console.log(`\n${exam.examId}: source has no per-question "topic" field — skipping (not checkable).`);
      continue;
    }
    if (sourceQuestions.length !== shipped.length) {
      console.warn(
        `\n${exam.examId}: source (${sourceQuestions.length}) and shipped (${shipped.length}) question counts differ — ` +
          `data may be stale. Run \`npm run parse\` first.`
      );
    }

    const r = analyze(exam, topicIndex, sourceQuestions, shipped);
    const correctP = Number(pct(r.correct, r.checked));
    const wrongP = Number(pct(r.wrongOnly, r.checked));
    const pass = correctP >= MIN_CORRECT && wrongP <= MAX_WRONG;
    if (!pass) anyFail = true;

    console.log(`\n${"═".repeat(72)}`);
    console.log(`${exam.examId}  ·  ${exam.examName}  ·  ${r.idx.length} topics, ${r.checked} questions`);
    console.log(`${"─".repeat(72)}`);
    console.log(`  ${pass ? "✅ PASS" : "❌ FAIL"}   (thresholds: correct ≥ ${MIN_CORRECT}%, wrong-only ≤ ${MAX_WRONG}%)`);
    console.log(`  correct topic flagged : ${String(r.correct).padStart(4)}  (${pct(r.correct, r.checked)}%)`);
    console.log(`  wrong topic only      : ${String(r.wrongOnly).padStart(4)}  (${pct(r.wrongOnly, r.checked)}%)`);
    console.log(`  no match (lost)       : ${String(r.zero).padStart(4)}  (${pct(r.zero, r.checked)}%)`);
    console.log(`  (of correct, also flagged an extra topic: ${r.extraFlag})`);

    if (r.missingTopic.size) {
      console.log(`  ⚠️  ${r.missingTopic.size} source topic(s) have no matching study-guide title: ` +
        [...r.missingTopic].slice(0, 5).join(" | ") + (r.missingTopic.size > 5 ? " …" : ""));
    }

    const lowRecall = r.idx
      .map((t) => ({ t, p: r.per.get(t.id) }))
      .filter(({ p }) => p.n >= 2 && p.hit / p.n < 0.7)
      .sort((a, b) => a.p.hit / a.p.n - b.p.hit / b.p.n);
    if (lowRecall.length) {
      console.log(`\n  Low-recall topics (<70%):`);
      for (const { t, p } of lowRecall) console.log(`    ${String(p.hit).padStart(2)}/${String(p.n).padStart(2)}  ${t.title}`);
    }

    const deadTopics = r.idx.filter((t) => (r.per.get(t.id).n === 0));
    if (VERBOSE && deadTopics.length) {
      console.log(`\n  Topics with no questions in the bank: ${deadTopics.length}`);
    }

    if (r.wrongOnly) {
      console.log(`\n  Mislabeled questions (flagged wrong topic, true topic missed):`);
      for (const w of r.wrongList.slice(0, VERBOSE ? Infinity : 15)) {
        console.log(`    Q${w.num}  true="${w.topic}"  →  ${w.mapped.map((m) => `"${m}"`).join(", ")}`);
      }
      if (!VERBOSE && r.wrongList.length > 15) console.log(`    … and ${r.wrongList.length - 15} more (--verbose for all)`);
    }

    if (VERBOSE && r.zero) {
      console.log(`\n  Unmatched questions (num : true topic):`);
      for (const z of r.zeroList) console.log(`    Q${z.num}: ${z.topic}`);
    }
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log(anyFail ? "❌ One or more exams failed the thresholds." : "✅ All checked exams passed.");
  process.exit(anyFail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
