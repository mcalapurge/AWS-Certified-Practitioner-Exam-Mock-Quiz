import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  REPO_ROOT,
  THIN_TOPIC_THRESHOLD,
  buildReport,
  embedJson,
  escapeHtml,
  loadExams,
  parseWeight,
  renderHtml,
  renderMarkdown,
  summariseExam,
} from "../../scripts/question-report.mjs";

const q = (category, correct = ["A"], extra = {}) => ({ category, correct, ...extra });

const awsLike = () => ({
  examId: "aws-like",
  examName: "AWS-like exam",
  examShort: "AWS-X",
  provider: "aws",
  metaQuestionCount: 5,
  categoryLabel: "Practice set",
  weights: null,
  studyTopics: null,
  questions: [
    q("practice-exam-10", ["B"]),
    q("practice-exam-2", ["C"]),
    q("practice-exam-2", ["A", "D"]),
    q("practice-exam-1", ["D"]),
    q("practice-exam-1", ["A"]),
  ],
});

const claudeLike = () => ({
  examId: "claude-like",
  examName: "Claude-like exam",
  examShort: "CL-X",
  provider: "claude",
  metaQuestionCount: 6,
  categoryLabel: "Domain",
  weights: { Agents: 0.5, Tools: 0.5 },
  studyTopics: ["Loops", "Guardrails", "Schemas", "Empty topic"],
  questions: [
    q("Agents", ["A"], { topic: "Loops", complexity: "Foundational" }),
    q("Agents", ["B"], { topic: "Loops", complexity: "Application" }),
    q("Agents", ["C"], { topic: "Loops", complexity: "Application" }),
    q("Agents", ["D"], { topic: "Guardrails", complexity: "Application" }),
    q("Agents", ["A"], { topic: "Guardrails", complexity: "Application" }),
    q("Tools", ["A", "B"], { topic: "Schemas", complexity: "Analysis" }),
  ],
});

describe("parseWeight", () => {
  test("accepts percentage strings and fractions", () => {
    assert.equal(parseWeight("33.1%"), 0.331);
    assert.equal(parseWeight(0.14), 0.14);
    assert.equal(parseWeight("0.2"), 0.2);
  });
  test("returns null for unusable values", () => {
    assert.equal(parseWeight("n/a"), null);
    assert.equal(parseWeight(undefined), null);
  });
});

describe("summariseExam", () => {
  test("counts questions per category and sorts practice sets naturally", () => {
    const s = summariseExam(awsLike());
    assert.deepEqual(
      s.categories.map((c) => [c.name, c.count]),
      [
        ["practice-exam-1", 2],
        ["practice-exam-2", 2],
        ["practice-exam-10", 1],
      ],
    );
    assert.equal(s.questionCount, 5);
    assert.equal(
      s.categories.reduce((n, c) => n + c.share, 0),
      1,
    );
    assert.equal(s.topics, null);
    assert.equal(s.complexity, null);
    assert.deepEqual(s.warnings, []);
  });

  test("tallies the single-answer key and multi-select questions separately", () => {
    const s = summariseExam(awsLike());
    assert.deepEqual(s.answerKey, { A: 1, B: 1, C: 1, D: 1, other: 0, multiSelect: 1 });
  });

  test("orders weighted categories by blueprint and computes the delta", () => {
    const s = summariseExam(claudeLike());
    const [agents, tools] = s.categories;
    assert.equal(agents.name, "Agents");
    assert.equal(agents.count, 5);
    assert.equal(agents.target, 0.5);
    assert.ok(Math.abs(agents.delta - (5 / 6 - 0.5)) < 1e-12);
    assert.equal(tools.count, 1);
  });

  test("lists a weighted category with no questions at zero", () => {
    const exam = claudeLike();
    exam.weights = { ...exam.weights, Security: 0 };
    const s = summariseExam(exam);
    assert.deepEqual(
      s.categories.find((c) => c.name === "Security"),
      { name: "Security", count: 0, share: 0, target: 0, delta: 0 },
    );
  });

  test("flags blueprint drift, thin topics, empty study topics and meta mismatches", () => {
    const exam = claudeLike();
    exam.metaQuestionCount = 7;
    const w = summariseExam(exam).warnings.join("\n");
    assert.match(w, /meta\.json lists 7 questions but the data file has 6/);
    assert.match(w, /Agents: 83\.3% of questions vs a 50\.0% blueprint weight/);
    assert.match(w, /Study topics with no questions: Empty topic/);
    assert.match(
      w,
      new RegExp(
        `fewer than ${THIN_TOPIC_THRESHOLD} questions: Schemas \\(1\\), Guardrails \\(2\\)`,
      ),
    );
    assert.doesNotMatch(w, /Loops \(/);
  });

  test("flags untagged questions and topics missing from the study guide", () => {
    const exam = claudeLike();
    exam.questions.push(q("Tools", ["C"], { topic: null }), q("Tools", ["D"], { topic: "Orphan" }));
    exam.metaQuestionCount = exam.questions.length;
    const w = summariseExam(exam).warnings.join("\n");
    assert.match(w, /1 question\(s\) have no topic tag/);
    assert.match(w, /Question topics with no study-guide section: Orphan/);
  });

  test("reports topics fewest-first with their domain", () => {
    const s = summariseExam(claudeLike());
    assert.deepEqual(
      s.topics.map((t) => [t.name, t.category, t.count]),
      [
        ["Empty topic", null, 0],
        ["Schemas", "Tools", 1],
        ["Guardrails", "Agents", 2],
        ["Loops", "Agents", 3],
      ],
    );
    assert.deepEqual(s.complexity, [
      { name: "Analysis", count: 1 },
      { name: "Application", count: 4 },
      { name: "Foundational", count: 1 },
    ]);
  });
});

describe("buildReport", () => {
  test("totals questions and warnings across exams", () => {
    const r = buildReport([awsLike(), claudeLike()], {
      generatedAt: "2026-01-01T00:00:00Z",
      commit: "abc",
    });
    assert.equal(r.schemaVersion, 1);
    assert.equal(r.generatedAt, "2026-01-01T00:00:00Z");
    assert.equal(r.commit, "abc");
    assert.equal(r.totals.exams, 2);
    assert.equal(r.totals.questions, 11);
    assert.equal(
      r.totals.warnings,
      r.exams.reduce((n, e) => n + e.warnings.length, 0),
    );
  });
});

describe("rendering", () => {
  const report = () => {
    const exam = claudeLike();
    exam.examName = `Tricky <script>alert("x")</script> & co`;
    exam.questions[0].category = "</script><img src=x>";
    return buildReport([awsLike(), exam], {
      generatedAt: "2026-01-01T00:00:00Z",
      commit: "0123456789abcdef",
    });
  };

  test("escapeHtml neutralises markup", () => {
    assert.equal(
      escapeHtml(`<a href="x">'&'</a>`),
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  test("embedJson cannot close the script element", () => {
    const s = embedJson({ v: "</script><script>alert(1)</script>" });
    assert.ok(!s.includes("</script>"));
    assert.deepEqual(JSON.parse(s), { v: "</script><script>alert(1)</script>" });
  });

  test("renderHtml produces a self-contained page with escaped content and embedded data", () => {
    const r = report();
    const html = renderHtml(r);
    assert.match(html, /^<!doctype html>/);
    assert.ok(!/<script(?![^>]*type="application\/json")/.test(html), "no executable scripts");
    assert.ok(!/(src|href)="https?:/.test(html), "no external resources");
    assert.ok(html.includes("Tricky &lt;script&gt;"));
    assert.ok(!html.includes("<img src=x>"));
    assert.ok(html.includes("0123456789ab"));
    assert.ok(html.includes('id="claude-like"'));

    const embedded = html.match(
      /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/,
    );
    assert.ok(embedded, "embedded report data present");
    assert.deepEqual(JSON.parse(embedded[1]), r);
  });

  test("renderHtml shows blueprint columns only for weighted exams", () => {
    const html = renderHtml(report());
    const [awsSection, claudeSection] = html.split("<section id=").slice(1);
    assert.ok(!awsSection.includes("Blueprint"));
    assert.ok(claudeSection.includes("Blueprint"));
  });

  test("renderMarkdown lists every exam and category", () => {
    const md = renderMarkdown(report());
    assert.match(md, /\| AWS-X \| 5 \| 3 \| 0 \|/);
    assert.match(md, /### CL-X by domain/);
    assert.match(md, /\| practice-exam-10 \| 1 \| 20\.0% \|/);
  });
});

describe("against the repository data", () => {
  test("every exam's counts reconcile with meta.json and the data files", async () => {
    const meta = JSON.parse(
      await readFile(path.join(REPO_ROOT, "src/features/quiz/data/meta.json"), "utf8"),
    );
    const report = buildReport(await loadExams());
    assert.deepEqual(report.exams.map((e) => e.examId).sort(), Object.keys(meta).sort());
    for (const e of report.exams) {
      assert.equal(e.questionCount, meta[e.examId].questionCount, `${e.examId} question count`);
      assert.equal(
        e.categories.reduce((n, c) => n + c.count, 0),
        e.questionCount,
        `${e.examId} categories sum to the total`,
      );
      assert.ok(!e.warnings.some((w) => w.startsWith("meta.json")), `${e.examId} meta mismatch`);
    }
  });

  test("prebuilt (Claude) exams get topics and blueprint weights; AWS exams do not", async () => {
    const report = buildReport(await loadExams());
    for (const e of report.exams) {
      if (e.provider === "claude") {
        assert.equal(e.categoryLabel, "Domain");
        assert.ok(e.topics.length > 0);
        assert.equal(
          e.topics.reduce((n, t) => n + t.count, 0),
          e.questionCount,
        );
        assert.ok(e.categories.every((c) => c.target !== null));
        assert.ok(
          !e.warnings.some((w) => w.includes("no topic tag")),
          `${e.examId} untagged questions`,
        );
      } else {
        assert.equal(e.categoryLabel, "Practice set");
        assert.equal(e.topics, null);
      }
    }
  });
});

describe("CLI", () => {
  test("writes the HTML and JSON reports and appends a job summary", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "question-report-"));
    try {
      const summary = path.join(dir, "summary.md");
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [path.join(REPO_ROOT, "scripts/question-report.mjs"), "--out", dir],
        { env: { ...process.env, GITHUB_STEP_SUMMARY: summary, GITHUB_SHA: "feedface" } },
      );
      assert.match(stdout, /Question report: \d+ questions, \d+ exams/);
      const json = JSON.parse(await readFile(path.join(dir, "question-report.json"), "utf8"));
      assert.equal(json.commit, "feedface");
      const html = await readFile(path.join(dir, "question-report.html"), "utf8");
      assert.match(html, /^<!doctype html>/);
      assert.match(await readFile(summary, "utf8"), /## Question coverage/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("answer-confidence counts", () => {
  test("are null for exams without ratings", () => {
    assert.equal(summariseExam(awsLike()).confidence, null);
  });

  test("count each rating and flag disputed or unrated questions", () => {
    const exam = claudeLike();
    const rags = ["green", "green", "amber", "red", null, "amber"];
    exam.questions.forEach((x, i) => {
      x.rag = rags[i];
      x.timeSensitive = i < 2;
    });
    const s = summariseExam(exam);
    assert.deepEqual(s.confidence, { green: 2, amber: 2, red: 1, unrated: 1, timeSensitive: 2 });
    const w = s.warnings.join("\n");
    assert.match(w, /1 question\(s\) have a disputed \(red\) answer key/);
    assert.match(w, /1 question\(s\) have no answer-confidence rating/);
    const html = renderHtml(buildReport([exam]));
    assert.match(
      html,
      /Verified 2 · .*Best practice 2 · .*Disputed 1 · Unrated 1 · Recently changed 2/,
    );
    assert.match(
      renderMarkdown(buildReport([exam])),
      /🟢 2 verified · 🟠 2 best practice · 🔴 1 disputed/,
    );
  });

  test("the real CCDV-F bank is fully rated with nothing disputed", async () => {
    const report = buildReport(await loadExams());
    const ccdvf = report.exams.find((e) => e.examId === "developer-foundations");
    assert.equal(ccdvf.confidence.unrated, 0);
    assert.equal(ccdvf.confidence.red, 0);
    assert.equal(ccdvf.confidence.green + ccdvf.confidence.amber, ccdvf.questionCount);
  });
});
