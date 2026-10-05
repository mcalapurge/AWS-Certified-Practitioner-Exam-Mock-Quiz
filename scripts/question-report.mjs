#!/usr/bin/env node
// Question-coverage report: how many questions each exam has per category.
//
// Reads the generated quiz data the app ships (src/features/quiz/data/) plus,
// for prebuilt (Claude) exams, the source bank and study guide under
// scripts/sources/ — only those carry per-question topics and blueprint
// weights. Writes two files:
//
//   question-report.json  canonical data (versioned schema), for diffing/tooling
//   question-report.html  self-contained view of the same data (inline CSS, no
//                         scripts, no network), with the JSON embedded
//
// When GITHUB_STEP_SUMMARY is set (GitHub Actions) a markdown digest is also
// appended to the job summary.
//
// Usage:
//   node scripts/question-report.mjs [--out <dir>]   # default: report/

import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");

export const SCHEMA_VERSION = 1;
// Topics with fewer questions than this are flagged as thin coverage.
export const THIN_TOPIC_THRESHOLD = 3;
// A category whose share is further than this from its blueprint weight is flagged.
export const WEIGHT_TOLERANCE = 0.05;
const LETTERS = ["A", "B", "C", "D"];
const RAGS = ["green", "amber", "red"];

const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

// Blueprint weights arrive as "33.1%" strings (CCDV-F) or 0.331 fractions (CCAO-F).
export function parseWeight(w) {
  if (typeof w === "number") return w;
  if (typeof w === "string") {
    const n = Number.parseFloat(w);
    if (Number.isFinite(n)) return w.trim().endsWith("%") ? n / 100 : n;
  }
  return null;
}

const byName = (a, b) => a.localeCompare(b, "en", { numeric: true });

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

// Pairs each <prefix>_study_guide.json with its <prefix>_practice_questions.json,
// keyed by the guide's examId (same discovery rule as check-topic-mapping.mjs).
async function loadPrebuiltSources(sourcesDir) {
  const out = new Map();
  if (!existsSync(sourcesDir)) return out;
  for (const f of (await readdir(sourcesDir)).filter((f) => f.endsWith("_study_guide.json"))) {
    const qFile = path.join(
      sourcesDir,
      f.replace(/_study_guide\.json$/, "_practice_questions.json"),
    );
    if (!existsSync(qFile)) continue;
    const guide = await readJson(path.join(sourcesDir, f));
    out.set(guide.examId, { guide, bank: await readJson(qFile) });
  }
  return out;
}

export async function loadExams(repoRoot = REPO_ROOT) {
  const quizDir = path.join(repoRoot, "src", "features", "quiz", "data");
  const meta = await readJson(path.join(quizDir, "meta.json"));
  const prebuilt = await loadPrebuiltSources(path.join(repoRoot, "scripts", "sources"));

  const exams = [];
  for (const m of Object.values(meta)) {
    const data = await readJson(path.join(quizDir, m.provider, `${m.examId}.json`));
    const src = prebuilt.get(m.examId);
    const sourceById = new Map((src?.bank.questions ?? []).map((q) => [q.id, q]));
    const weights = src?.bank.domain_weights
      ? Object.fromEntries(
          Object.entries(src.bank.domain_weights).map(([k, v]) => [k, parseWeight(v)]),
        )
      : null;

    exams.push({
      examId: m.examId,
      examName: m.examName,
      examShort: m.examShort,
      provider: m.provider,
      metaQuestionCount: m.questionCount,
      // AWS questions carry only their source file ("practice-exam-3"); prebuilt
      // exams carry a real blueprint domain.
      categoryLabel: src ? "Domain" : "Practice set",
      weights,
      studyTopics: src
        ? src.guide.sections.filter((s) => s.keywords.length > 0).map((s) => s.title)
        : null,
      questions: data.questions.map((q) => {
        const s = sourceById.get(q.number);
        return {
          category: q.examSet,
          correct: q.correct,
          topic: src ? (s?.topic ?? null) : undefined,
          complexity: s?.complexity ?? null,
          rag: s?.confidence?.rag ?? null,
          timeSensitive: s?.confidence?.timeSensitive === true,
        };
      }),
    });
  }
  return exams;
}

// ---------------------------------------------------------------------------
// Aggregation (pure)
// ---------------------------------------------------------------------------

function countBy(items, key) {
  const m = new Map();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return m;
}

export function summariseExam(exam) {
  const total = exam.questions.length;
  const share = (n) => (total ? n / total : 0);
  const warnings = [];

  if (exam.metaQuestionCount !== total) {
    warnings.push(
      `meta.json lists ${exam.metaQuestionCount} questions but the data file has ${total}.`,
    );
  }

  const catCounts = countBy(exam.questions, (q) => q.category);
  const weighted = exam.weights ? Object.keys(exam.weights) : [];
  const names = [
    ...weighted,
    ...[...catCounts.keys()].filter((c) => !weighted.includes(c)).sort(byName),
  ];
  const categories = names.map((name) => {
    const count = catCounts.get(name) ?? 0;
    const target = exam.weights?.[name] ?? null;
    const delta = target === null ? null : share(count) - target;
    if (delta !== null && Math.abs(delta) > WEIGHT_TOLERANCE) {
      warnings.push(
        `${name}: ${pct(share(count))} of questions vs a ${pct(target)} blueprint weight.`,
      );
    }
    return { name, count, share: share(count), target, delta };
  });

  let topics = null;
  if (exam.studyTopics) {
    const missing = exam.questions.filter((q) => !q.topic).length;
    if (missing) warnings.push(`${missing} question(s) have no topic tag.`);
    const topicCounts = countBy(
      exam.questions.filter((q) => q.topic),
      (q) => q.topic,
    );
    const domainOf = new Map(
      exam.questions.filter((q) => q.topic).map((q) => [q.topic, q.category]),
    );
    const all = new Set([...exam.studyTopics, ...topicCounts.keys()]);
    topics = [...all]
      .map((name) => ({
        name,
        category: domainOf.get(name) ?? null,
        count: topicCounts.get(name) ?? 0,
      }))
      .sort((a, b) => a.count - b.count || byName(a.name, b.name));
    const empty = topics.filter((t) => t.count === 0).map((t) => t.name);
    if (empty.length) warnings.push(`Study topics with no questions: ${empty.join(", ")}.`);
    const thin = topics.filter((t) => t.count > 0 && t.count < THIN_TOPIC_THRESHOLD);
    if (thin.length) {
      warnings.push(
        `${thin.length} topic(s) have fewer than ${THIN_TOPIC_THRESHOLD} questions: ${thin.map((t) => `${t.name} (${t.count})`).join(", ")}.`,
      );
    }
    const unguided = topics.filter((t) => t.count > 0 && !exam.studyTopics.includes(t.name));
    if (unguided.length) {
      warnings.push(
        `Question topics with no study-guide section: ${unguided.map((t) => t.name).join(", ")}.`,
      );
    }
  }

  const answerKey = { A: 0, B: 0, C: 0, D: 0, other: 0, multiSelect: 0 };
  for (const q of exam.questions) {
    if (q.correct.length > 1) answerKey.multiSelect++;
    else if (LETTERS.includes(q.correct[0])) answerKey[q.correct[0]]++;
    else answerKey.other++;
  }

  const complexityCounts = countBy(
    exam.questions.filter((q) => q.complexity),
    (q) => q.complexity,
  );
  const complexity = complexityCounts.size
    ? [...complexityCounts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => byName(a.name, b.name))
    : null;

  // Answer-key review ratings (prebuilt exams only). null when nothing was reviewed.
  let confidence = null;
  if (exam.questions.some((q) => q.rag)) {
    confidence = { green: 0, amber: 0, red: 0, unrated: 0, timeSensitive: 0 };
    for (const q of exam.questions) {
      if (RAGS.includes(q.rag)) confidence[q.rag]++;
      else confidence.unrated++;
      if (q.timeSensitive) confidence.timeSensitive++;
    }
    if (confidence.red)
      warnings.push(`${confidence.red} question(s) have a disputed (red) answer key.`);
    if (confidence.unrated)
      warnings.push(`${confidence.unrated} question(s) have no answer-confidence rating.`);
  }

  return {
    examId: exam.examId,
    examName: exam.examName,
    examShort: exam.examShort,
    provider: exam.provider,
    questionCount: total,
    categoryLabel: exam.categoryLabel,
    categories,
    topics,
    complexity,
    answerKey,
    confidence,
    warnings,
  };
}

export function buildReport(exams, { generatedAt = new Date().toISOString(), commit = null } = {}) {
  const summaries = exams.map(summariseExam);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    commit,
    totals: {
      exams: summaries.length,
      questions: summaries.reduce((n, e) => n + e.questionCount, 0),
      warnings: summaries.reduce((n, e) => n + e.warnings.length, 0),
    },
    exams: summaries,
  };
}

// ---------------------------------------------------------------------------
// Rendering (pure)
// ---------------------------------------------------------------------------

export function pct(x, digits = 1) {
  return `${(x * 100).toFixed(digits)}%`;
}

export function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// JSON inside <script type="application/json"> must not be able to close the tag.
export function embedJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

const bar = (share) =>
  `<span class="bar" aria-hidden="true"><span style="width:${Math.min(100, share * 100).toFixed(1)}%"></span></span>`;

function signedPct(d) {
  return `${d >= 0 ? "+" : "−"}${pct(Math.abs(d))}`;
}

function renderExam(e) {
  const maxShare = Math.max(...e.categories.map((c) => c.share), 0.0001);
  const hasTargets = e.categories.some((c) => c.target !== null);
  const catRows = e.categories
    .map(
      (c) => `<tr>
          <th scope="row">${escapeHtml(c.name)}</th>
          <td class="num">${c.count}</td>
          <td class="num">${pct(c.share)}</td>
          <td class="viz hide-sm">${bar(c.share / maxShare)}</td>${
            hasTargets
              ? `
          <td class="num">${c.target === null ? "—" : pct(c.target)}</td>
          <td class="num ${c.delta !== null && Math.abs(c.delta) > WEIGHT_TOLERANCE ? "warn" : ""}">${c.delta === null ? "—" : signedPct(c.delta)}</td>`
              : ""
          }
        </tr>`,
    )
    .join("");

  const topicTable = e.topics
    ? `<details>
        <summary>${e.topics.length} topics (fewest questions first)</summary>
        <table>
          <thead><tr><th scope="col">Topic</th><th scope="col">Domain</th><th scope="col" class="num">Questions</th></tr></thead>
          <tbody>${e.topics
            .map(
              (t) =>
                `<tr${t.count < THIN_TOPIC_THRESHOLD ? ' class="thin"' : ""}><th scope="row">${escapeHtml(t.name)}</th><td>${escapeHtml(t.category ?? "—")}</td><td class="num">${t.count}</td></tr>`,
            )
            .join("")}</tbody>
        </table>
      </details>`
    : "";

  const ak = e.answerKey;
  const single = LETTERS.reduce((n, l) => n + ak[l], 0) || 1;
  const answerRow = LETTERS.map(
    (l) => `<td class="num">${ak[l]} <small>(${pct(ak[l] / single, 0)})</small></td>`,
  ).join("");

  const complexity = e.complexity
    ? `<p class="muted">Complexity: ${e.complexity.map((c) => `${escapeHtml(c.name)} ${c.count}`).join(" · ")}</p>`
    : "";

  const c = e.confidence;
  const confidenceLine = c
    ? `<p class="muted">Answer confidence: <span class="rag rag-green">●</span> Verified ${c.green} · <span class="rag rag-amber">●</span> Best practice ${c.amber} · <span class="rag rag-red">●</span> Disputed ${c.red}${
        c.unrated ? ` · Unrated ${c.unrated}` : ""
      } · Recently changed ${c.timeSensitive}</p>`
    : "";

  const warnings = e.warnings.length
    ? `<ul class="warnings">${e.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`
    : `<p class="ok">No coverage warnings.</p>`;

  return `<section id="${escapeHtml(e.examId)}">
      <h2>${escapeHtml(e.examShort)} <span class="muted">· ${escapeHtml(e.examName)}</span></h2>
      <p class="muted">${e.questionCount} questions · ${e.categories.length} ${escapeHtml(e.categoryLabel.toLowerCase())}s · provider: ${escapeHtml(e.provider)}</p>
      <table>
        <thead><tr>
          <th scope="col">${escapeHtml(e.categoryLabel)}</th>
          <th scope="col" class="num">Questions</th>
          <th scope="col" class="num">Share</th>
          <th scope="col" class="hide-sm"><span class="sr-only">Distribution</span></th>${
            hasTargets
              ? `<th scope="col" class="num">Blueprint</th><th scope="col" class="num">Δ</th>`
              : ""
          }
        </tr></thead>
        <tbody>${catRows}</tbody>
      </table>
      ${topicTable}
      <table class="compact">
        <caption>Single-answer key spread (${ak.multiSelect} multi-select${ak.other ? `, ${ak.other} other` : ""})</caption>
        <thead><tr>${LETTERS.map((l) => `<th scope="col" class="num">${l}</th>`).join("")}</tr></thead>
        <tbody><tr>${answerRow}</tr></tbody>
      </table>
      ${complexity}
      ${confidenceLine}
      ${warnings}
    </section>`;
}

export function renderHtml(report) {
  const overview = report.exams
    .map(
      (e) =>
        `<tr><th scope="row" class="code"><a href="#${escapeHtml(e.examId)}">${escapeHtml(e.examShort)}</a></th><td class="hide-sm">${escapeHtml(e.examName)}</td><td class="hide-sm">${escapeHtml(e.provider)}</td><td class="num">${e.questionCount}</td><td class="num">${e.categories.length}</td><td class="num">${e.topics ? e.topics.length : "—"}</td><td class="num ${e.warnings.length ? "warn" : ""}">${e.warnings.length}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Question Coverage Report</title>
<style>
  :root { --bg:#fafaf9; --fg:#1c1917; --muted:#57534e; --line:#e7e5e4; --card:#ffffff; --accent:#c2410c; --warn:#b45309; --ok:#15803d; --bad:#b91c1c; --track:#f5f5f4; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#1c1917; --fg:#f5f5f4; --muted:#a8a29e; --line:#44403c; --card:#292524; --accent:#fb923c; --warn:#fbbf24; --ok:#4ade80; --bad:#f87171; --track:#44403c; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1000px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  h2 { font-size: 1.25rem; margin: 0 0 4px; }
  section { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:20px; margin-top:20px; overflow-x:auto; }
  table { width:100%; border-collapse:collapse; margin:12px 0; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:middle; }
  thead th { font-size:.8rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  tbody th { font-weight:500; }
  caption { text-align:left; color:var(--muted); font-size:.85rem; }
  .num { text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .viz { width:30%; }
  .bar { display:block; height:10px; background:var(--track); border-radius:5px; overflow:hidden; }
  .bar > span { display:block; height:100%; background:var(--accent); }
  .muted { color:var(--muted); font-weight:400; }
  .warn { color:var(--warn); font-weight:600; }
  .ok { color:var(--ok); }
  .thin th, .thin td { color:var(--warn); }
  .warnings { color:var(--warn); padding-left:20px; }
  .compact { width:auto; }
  details { margin:8px 0; }
  summary { cursor:pointer; color:var(--accent); }
  a { color:var(--accent); }
  .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
  .code { white-space:nowrap; }
  .rag-green { color:var(--ok); }
  .rag-amber { color:var(--warn); }
  .rag-red { color:var(--bad); }
  @media (max-width: 640px) {
    .hide-sm { display:none; }
    section { padding:14px; }
    th, td { padding:6px 4px; }
  }
</style>
</head>
<body>
<main>
  <h1>Question Coverage Report</h1>
  <p class="muted">${report.totals.questions} questions across ${report.totals.exams} exams · generated ${escapeHtml(report.generatedAt)}${
    report.commit ? ` · commit <code>${escapeHtml(report.commit.slice(0, 12))}</code>` : ""
  }</p>
  <section>
    <table>
      <thead><tr><th scope="col">Exam</th><th scope="col" class="hide-sm">Name</th><th scope="col" class="hide-sm">Provider</th><th scope="col" class="num">Questions</th><th scope="col" class="num">Categories</th><th scope="col" class="num">Topics</th><th scope="col" class="num">Warnings</th></tr></thead>
      <tbody>${overview}</tbody>
    </table>
  </section>
  ${report.exams.map(renderExam).join("\n")}
</main>
<script type="application/json" id="report-data">${embedJson(report)}</script>
</body>
</html>
`;
}

// Markdown digest for the GitHub Actions job summary.
export function renderMarkdown(report) {
  const lines = [
    "## Question coverage",
    "",
    `${report.totals.questions} questions across ${report.totals.exams} exams. Full breakdown in the \`question-report.html\` artifact.`,
    "",
    "| Exam | Questions | Categories | Warnings |",
    "| --- | ---: | ---: | ---: |",
    ...report.exams.map(
      (e) =>
        `| ${e.examShort} | ${e.questionCount} | ${e.categories.length} | ${e.warnings.length} |`,
    ),
  ];
  for (const e of report.exams) {
    lines.push(
      "",
      `### ${e.examShort} by ${e.categoryLabel.toLowerCase()}`,
      "",
      `| ${e.categoryLabel} | Questions | Share |`,
      "| --- | ---: | ---: |",
    );
    for (const c of e.categories)
      lines.push(`| ${c.name.replaceAll("|", "\\|")} | ${c.count} | ${pct(c.share)} |`);
    if (e.confidence) {
      const c = e.confidence;
      lines.push(
        "",
        `Answer confidence: 🟢 ${c.green} verified · 🟠 ${c.amber} best practice · 🔴 ${c.red} disputed · ${c.timeSensitive} recently changed`,
      );
    }
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2), env = process.env) {
  const outIdx = argv.indexOf("--out");
  const outDir = path.resolve(
    outIdx >= 0 && argv[outIdx + 1] ? argv[outIdx + 1] : path.join(REPO_ROOT, "report"),
  );

  const report = buildReport(await loadExams(), { commit: env.GITHUB_SHA ?? null });
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "question-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(path.join(outDir, "question-report.html"), renderHtml(report));
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, renderMarkdown(report));

  console.log(
    `Question report: ${report.totals.questions} questions, ${report.totals.exams} exams → ${outDir}`,
  );
  for (const e of report.exams) {
    console.log(
      `  ${e.examShort.padEnd(8)} ${String(e.questionCount).padStart(5)} questions, ${e.warnings.length} warning(s)`,
    );
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
