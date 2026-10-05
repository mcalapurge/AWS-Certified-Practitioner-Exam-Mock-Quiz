import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyPatch,
  blindItem,
  buildPattern,
  contentHash,
  deriveConfidence,
  diffBank,
  fillSourceIds,
  flagReasons,
  haystack,
  lintConfidence,
  lintContext,
  keyLengthRanks,
  lintQuestion,
  longestKeyedShare,
  main,
  refreshMeta,
  reviewReason,
  suggestKeywords,
  REPO_ROOT,
} from "../../scripts/review-questions.mjs";

const q = (over = {}) => ({
  id: 1,
  domain: "Tools",
  topic: "Prompt Caching",
  complexity: "Foundational",
  topic_difficulty: "Easy",
  question: "Which request field marks the end of a cacheable prompt prefix?",
  options: {
    A: "A cache_control breakpoint on the last block to cache",
    B: "A temperature of zero on the request",
    C: "The stop_sequences parameter on the request",
    D: "A metadata user_id value on the request",
  },
  correct: ["A"],
  explanation: "cache_control marks the breakpoint; everything before it is cached as a prefix.",
  source_id: 20001,
  ...over,
});

const bank = (questions) => ({
  exam: "Demo",
  domain_weights: { Tools: "60%", Agents: "40%" },
  actual_domain_distribution: { Tools: 1, Agents: 0 },
  total_questions: questions.length,
  tagging_legend: {
    complexity: {
      Foundational: "Recall",
      Application: "Scenario",
      Analysis: "Multi-select item requiring several statements to be judged",
    },
  },
  questions,
});

const guide = {
  examId: "demo",
  sections: [
    { title: "Prompt Caching", keywords: ["cache_control"] },
    { title: "Agent Loops", keywords: ["agent loop"] },
  ],
};

const greenAnswer = {
  answer: ["A"],
  confidence: "high",
  basis: "verified",
  sources: ["https://platform.claude.com/docs/en/build-with-claude/prompt-caching"],
};

describe("diffBank", () => {
  test("separates added, content-changed, retagged and removed questions", () => {
    const base = bank([
      q({ id: 1 }),
      q({ id: 2, question: "Old stem?" }),
      q({ id: 3 }),
      q({ id: 4 }),
    ]);
    const head = bank([
      q({ id: 1 }),
      q({ id: 2, question: "New stem?" }),
      q({ id: 3, topic: "Agent Loops" }),
      q({ id: 5 }),
    ]);
    const d = diffBank(base, head);
    assert.deepEqual(d.added, [5]);
    assert.deepEqual(d.changed, [{ id: 2, fields: ["question"] }]);
    assert.deepEqual(d.retagged, [{ id: 3, fields: ["topic"] }]);
    assert.deepEqual(d.removed, [4]);
  });

  test("a bank that's new in this piece of work is all additions", () => {
    assert.deepEqual(diffBank(null, bank([q({ id: 7 })])).added, [7]);
  });

  test("reordering option keys is not a change", () => {
    const o = q().options;
    const shuffled = { D: o.D, C: o.C, B: o.B, A: o.A };
    assert.deepEqual(diffBank(bank([q()]), bank([q({ options: shuffled })])).changed, []);
  });
});

describe("reviewReason", () => {
  const rated = q({ confidence: { rag: "green", reviewed: "2026-10-01" } });
  const edited = { ...rated, question: "Edited?" };
  test("unrated questions need a review", () => {
    assert.match(reviewReason([null, q()]), /no confidence/);
  });
  test("a rating carried over from the base onto edited content is stale", () => {
    assert.match(reviewReason([rated, edited]), /changed after it was last rated/);
  });
  test("a rating made earlier in the same work is stale once the content is edited again", () => {
    assert.match(reviewReason([null, rated, edited]), /changed after it was last rated/);
  });
  test("a rating refreshed with (or after) the edit is current", () => {
    const rerated = { ...edited, confidence: { rag: "amber", reviewed: "2026-10-05" } };
    assert.equal(reviewReason([rated, rerated]), null);
    assert.equal(reviewReason([null, q(), rated]), null);
    assert.equal(
      reviewReason([null, rated, { ...rated, topic: "Agent Loops" }]),
      null,
      "retags don't count",
    );
  });
  test("a recorded content hash decides staleness, even for an identical re-rating", () => {
    const stamped = {
      ...edited,
      confidence: { ...rated.confidence, contentHash: contentHash(edited) },
    };
    assert.equal(reviewReason([rated, stamped]), null);
    const editedAgain = { ...stamped, explanation: "Changed again." };
    assert.match(reviewReason([rated, stamped, editedAgain]), /changed after it was last rated/);
  });
  test("--all re-reviews everything", () => {
    assert.match(reviewReason([null, rated], { all: true }), /--all/);
  });
});

describe("lintQuestion", () => {
  const ctxFor = (qs) => lintContext(bank(qs), guide);
  const errors = (x, qs = [x]) =>
    lintQuestion(x, ctxFor(qs))
      .filter((p) => p.level === "error")
      .map((p) => p.message);

  test("a well-formed question has no problems", () => {
    assert.deepEqual(lintQuestion(q(), ctxFor([q()])), []);
  });

  test("catches broken options and keys", () => {
    assert.match(errors(q({ options: { A: "x", B: "y", C: "z" } })).join(), /exactly A–D/);
    assert.match(errors(q({ correct: ["E"] })).join(), /not an option/);
    assert.match(errors(q({ correct: [] })).join(), /at least one/);
    assert.match(errors(q({ options: { ...q().options, B: q().options.A } })).join(), /identical/);
  });

  test("checks tags against the bank and the study guide", () => {
    assert.match(errors(q({ domain: "Nope" })).join(), /domain_weights/);
    assert.match(errors(q({ topic: "Nope" })).join(), /study-guide section/);
    assert.match(errors(q({ complexity: "Hardcore" })).join(), /tagging_legend/);
    assert.match(errors(q({ topic_difficulty: "Brutal" })).join(), /topic_difficulty/);
  });

  test("multi-select stems must say how many, and be tagged Analysis", () => {
    assert.match(
      errors(q({ correct: ["A", "B"], complexity: "Analysis" })).join(),
      /Select the TWO/,
    );
    const ok = q({
      question: "Select the TWO valid fields.",
      correct: ["A", "B"],
      complexity: "Analysis",
    });
    assert.deepEqual(errors(ok), []);
    assert.match(errors({ ...ok, complexity: "Application" }).join(), /Analysis/);
    assert.match(
      errors(q({ question: "Select the TWO valid fields." })).join(),
      /only one is keyed/,
    );
  });

  test("flags duplicates as errors and near-duplicates as warnings", () => {
    const a = q({ id: 1 });
    assert.match(errors(a, [a, q({ id: 2 })]).join(), /duplicate of question 2/);
    const near = q({
      id: 3,
      question: q().question.replace("?", " today?"),
      options: { ...q().options, D: "Other" },
    });
    const warns = lintQuestion(a, ctxFor([a, near])).filter((p) => p.level === "warn");
    assert.match(warns.map((w) => w.message).join(), /nearly identical to question 3/);
  });

  test("warns about length tells and exam-meta wording", () => {
    const tell = q({
      options: {
        A: "A cache_control breakpoint placed on the final block of the stable prefix you want reused",
        B: "Temperature",
        C: "Stop sequences",
        D: "Metadata",
      },
    });
    assert.match(lintQuestion(tell, ctxFor([tell]))[0].message, /length tell/);
    const meta = q({
      question: "As tested elsewhere in this domain, which field marks the prefix?",
    });
    assert.match(lintQuestion(meta, ctxFor([meta]))[0].message, /exam-meta/);
  });

  test("validates an attached rating", () => {
    const bad = q({
      confidence: {
        rag: "green",
        level: "high",
        basis: "reasoning",
        timeSensitive: false,
        reviewed: "2026-10-05",
      },
    });
    assert.match(errors(bad).join(), /green needs/);
  });
});

describe("lintConfidence", () => {
  test("enforces the same evidence rules as the data test", () => {
    const base = {
      rag: "amber",
      level: "medium",
      basis: "reasoning",
      timeSensitive: false,
      reviewed: "2026-10-05",
    };
    assert.deepEqual(lintConfidence(base), []);
    assert.match(lintConfidence({ ...base, level: "low" }).join(), /low confidence must be red/);
    assert.match(lintConfidence({ ...base, basis: "docs" }).join(), /docs basis needs sources/);
    assert.match(
      lintConfidence({ ...base, sources: ["https://example.com/x"] }).join(),
      /not Anthropic docs/,
    );
    assert.deepEqual(lintConfidence({ ...base, contentHash: "0123456789abcdef" }), []);
    assert.match(lintConfidence({ ...base, contentHash: "abc" }).join(), /contentHash/);
  });
});

test("longestKeyedShare counts keys that are the strictly longest option", () => {
  const long = q({ options: { ...q().options, A: "x".repeat(200) } });
  const short = q({ options: { ...q().options, A: "x" } });
  const multi = q({ correct: ["A", "B"] });
  assert.deepEqual(longestKeyedShare([long, short, multi]), { longest: 1, single: 2 });
});

test("keyLengthRanks counts how many options outlast each key", () => {
  const long = q({ options: { ...q().options, A: "x".repeat(200) } });
  const short = q({ options: { ...q().options, A: "x" } });
  const second = q({ options: { ...q().options, B: "x".repeat(200) } });
  const multi = q({ correct: ["A", "B"] });
  assert.deepEqual(keyLengthRanks([long, short, second, multi]), {
    ranks: [1, 1, 0, 1],
    single: 3,
  });
});

test("blindItem hides the key, explanation, topic and rating", () => {
  const item = blindItem("demo", q({ confidence: { rag: "green" } }));
  assert.deepEqual(Object.keys(item).sort(), ["bank", "id", "options", "question", "select"]);
  assert.equal(item.select, 1);
});

test("flagReasons", () => {
  assert.deepEqual(flagReasons(q(), greenAnswer), []);
  assert.deepEqual(flagReasons(q(), { ...greenAnswer, answer: ["B"], confidence: "low" }), [
    "disagree",
    "low-confidence",
  ]);
  assert.deepEqual(
    flagReasons(q(), { ...greenAnswer, issues: "B is arguable", also_defensible: ["B"] }),
    ["issue", "other-defensible"],
  );
});

describe("deriveConfidence", () => {
  const derive = (answer, verdict, prior) =>
    deriveConfidence({ key: ["A"], answer, verdict, date: "2026-10-05", prior });

  test("blind match, high confidence, docs-backed → green", () => {
    const { confidence, unresolved } = derive(greenAnswer);
    assert.equal(unresolved, false);
    assert.deepEqual(confidence, {
      rag: "green",
      level: "high",
      basis: "docs",
      timeSensitive: false,
      reviewed: "2026-10-05",
      sources: greenAnswer.sources,
    });
  });

  test("judgement-based or medium-confidence matches → amber", () => {
    assert.equal(
      derive({ ...greenAnswer, basis: "reasoning", sources: [] }).confidence.rag,
      "amber",
    );
    assert.equal(derive({ ...greenAnswer, confidence: "medium" }).confidence.rag, "amber");
  });

  test("non-Anthropic sources are dropped, and with them the docs basis", () => {
    const c = derive({ ...greenAnswer, sources: ["https://blog.example.com/caching"] }).confidence;
    assert.equal(c.basis, "reasoning");
    assert.equal(c.rag, "amber");
    assert.equal(c.sources, undefined);
  });

  test("an unadjudicated disagreement is red and unresolved", () => {
    const r = derive({ ...greenAnswer, answer: ["B"] });
    assert.equal(r.unresolved, true);
    assert.equal(r.confidence.rag, "red");
    assert.equal(r.confidence.level, "low");
  });

  test("a disagreement the adjudicator resolves is capped at amber", () => {
    const keep = derive(
      { ...greenAnswer, answer: ["B"] },
      { verdict: "keep", sources: greenAnswer.sources },
    );
    assert.equal(keep.confidence.rag, "amber");
    assert.equal(keep.confidence.level, "medium");
    const fix = derive(
      { ...greenAnswer, answer: ["B"] },
      { verdict: "fix", patch: { question: "Clearer?" } },
    );
    assert.equal(fix.confidence.reworded, true);
    assert.equal(fix.confidence.rag, "amber");
  });

  test("an adjudicator's sources don't make a judgement call green", () => {
    const judgement = { ...greenAnswer, basis: "reasoning", issues: "Judgement call" };
    const fix = derive(judgement, {
      verdict: "fix",
      sources: greenAnswer.sources,
      patch: { explanation: "x" },
    });
    assert.equal(fix.confidence.basis, "reasoning");
    assert.equal(fix.confidence.rag, "amber");
    assert.deepEqual(fix.confidence.sources, greenAnswer.sources, "but they're still recorded");
  });

  test("a dispute is red; time sensitivity follows the adjudicator", () => {
    assert.equal(derive(greenAnswer, { verdict: "dispute" }).confidence.rag, "red");
    const ts = derive(
      { ...greenAnswer, time_sensitive: true },
      { verdict: "keep", time_sensitive: false },
    );
    assert.equal(ts.confidence.timeSensitive, false);
    assert.equal(derive({ ...greenAnswer, time_sensitive: true }).confidence.timeSensitive, true);
  });

  test("every derived rating passes the rating rules", () => {
    const answers = [
      greenAnswer,
      { ...greenAnswer, answer: ["B"] },
      { ...greenAnswer, confidence: "low" },
    ];
    const verdicts = [
      undefined,
      { verdict: "keep" },
      { verdict: "dispute" },
      { verdict: "fix", patch: { explanation: "x" } },
    ];
    for (const a of answers)
      for (const v of verdicts) assert.deepEqual(lintConfidence(derive(a, v).confidence), []);
  });
});

describe("applyPatch", () => {
  test("merges options and normalises the key", () => {
    const next = applyPatch(q(), { options: { B: "New B" }, correct: ["b"] });
    assert.equal(next.options.A, q().options.A);
    assert.equal(next.options.B, "New B");
    assert.deepEqual(next.correct, ["B"]);
  });
  test("refuses to touch tags or ids", () => {
    assert.throws(() => applyPatch(q(), { topic: "Other" }), /may only touch/);
  });
});

test("refreshMeta recounts totals and the domain mix", () => {
  const b = refreshMeta(
    bank([q({ domain: "Tools" }), q({ id: 2, domain: "Agents" }), q({ id: 3, domain: "Agents" })]),
  );
  assert.equal(b.total_questions, 3);
  assert.deepEqual(b.actual_domain_distribution, { Tools: 0.3333, Agents: 0.6667 });
});

test("fillSourceIds uses 20000 + id and never collides", () => {
  const out = fillSourceIds([
    q({ id: 1, source_id: 20002 }),
    { ...q({ id: 2 }), source_id: undefined },
    { ...q({ id: 3 }), source_id: undefined },
  ]);
  // 20002 is taken by question 1, so question 2 moves past the highest id in use.
  const rated = fillSourceIds([
    { ...q({ id: 9 }), source_id: undefined, confidence: { rag: "green" } },
  ])[0];
  assert.deepEqual(Object.keys(rated).slice(-2), ["source_id", "confidence"]);
  assert.deepEqual(
    out.map((x) => x.source_id),
    [20002, 20003, 20004],
  );
});

describe("suggestKeywords", () => {
  const caching = q({ id: 1 });
  const agent = q({
    id: 2,
    topic: "Agent Loops",
    question: "When should an orchestrator stop calling tools?",
    options: { A: "When stop_reason is end_turn", B: "Never", C: "After one turn", D: "Randomly" },
    explanation: "Continue the orchestrator loop while stop_reason is tool_use.",
  });
  const b = bank([caching, agent]);

  test("proposes keywords that match only the question's own topic", () => {
    const [res] = suggestKeywords(b, guide, [2]);
    assert.equal(res.topic, "Agent Loops");
    assert.deepEqual(res.stillUnmatched, []);
    for (const { keyword } of res.add) {
      const pat = buildPattern([keyword]);
      assert.ok(pat.test(haystack(agent)), keyword);
      assert.ok(!pat.test(haystack(caching)), `${keyword} must not flag the caching question`);
    }
  });

  test("questions that already map are left alone", () => {
    assert.deepEqual(suggestKeywords(b, guide, [1]), []);
  });
});

test("every question in the repo's banks passes lint", async () => {
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    assert.equal(await main(["lint", "--root", REPO_ROOT]), 0, lines.join("\n"));
  } finally {
    console.log = log;
  }
});

describe("CLI: prepare → compare → apply on a scratch repo", () => {
  let dir;
  const run = async (...args) => {
    const lines = [];
    const log = console.log;
    const err = console.error;
    console.log = (...a) => lines.push(a.join(" "));
    console.error = (...a) => lines.push(a.join(" "));
    try {
      return { code: await main([...args, "--root", dir]), out: lines.join("\n") };
    } finally {
      console.log = log;
      console.error = err;
    }
  };
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  const src = (f) => path.join(dir, "scripts/sources", f);
  const readBank = async () =>
    JSON.parse(await readFile(src("demo_practice_questions.json"), "utf8"));
  const writeBank = (b) =>
    writeFile(src("demo_practice_questions.json"), JSON.stringify(b, null, 2));
  const out = (...p) => path.join(dir, "report/question-review", ...p);

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "review-questions-"));
    await mkdir(path.join(dir, "scripts/sources"), { recursive: true });
    await writeFile(src("demo_study_guide.json"), JSON.stringify(guide, null, 2));
    await writeBank(bank([q({ id: 1 })]));
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base");
    git("branch", "-M", "main");
    // The piece of work: two new questions, one without a source_id.
    const b = await readBank();
    b.questions.push(
      q({
        id: 2,
        topic: "Agent Loops",
        domain: "Agents",
        question: "When should an orchestrator stop calling tools?",
        options: {
          A: "When stop_reason is end_turn",
          B: "Never",
          C: "After exactly one turn",
          D: "At random",
        },
        explanation:
          "Keep running the orchestrator loop while stop_reason is tool_use; stop on end_turn.",
        source_id: undefined,
      }),
      q({
        id: 3,
        question: "Which pricing multiplier applies to a cache read?",
        options: { A: "0.1x the base input price", B: "2x", C: "1.25x", D: "Free" },
        explanation: "Cache reads cost a tenth of the base input token price.",
        source_id: 20003,
      }),
    );
    await writeBank(b);
  });
  after(() => rm(dir, { recursive: true, force: true }));

  test("diff finds the new questions against the merge-base with main", async () => {
    const { code, out: text } = await run("diff");
    assert.equal(code, 0, text);
    assert.match(text, /demo: \+2 added/);
    assert.match(text, /2 need review/);
  });

  test("prepare writes blind batches with no key", async () => {
    const { code } = await run("prepare", "--batch-size", "1");
    assert.equal(code, 0);
    const batches = (await readdir(out("blind"))).sort();
    assert.deepEqual(batches, ["batch-01.json", "batch-02.json"]);
    const [item] = JSON.parse(await readFile(out("blind", batches[0]), "utf8"));
    assert.equal(item.correct, undefined);
    assert.equal(item.explanation, undefined);
  });

  test("compare flags the disagreement and apply refuses to rate it without a verdict", async () => {
    await writeFile(
      out("answers", "batch-01.json"),
      JSON.stringify([
        {
          bank: "demo",
          id: 2,
          answer: ["A"],
          confidence: "high",
          basis: "verified",
          sources: ["https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview"],
          time_sensitive: false,
        },
      ]),
    );
    await writeFile(
      out("answers", "batch-02.json"),
      JSON.stringify([
        {
          bank: "demo",
          id: 3,
          answer: ["C"],
          confidence: "medium",
          basis: "reasoning",
          sources: [],
          issues: "Thought 1.25x was the read price",
        },
      ]),
    );
    const cmp = await run("compare");
    assert.equal(cmp.code, 0, cmp.out);
    assert.match(cmp.out, /1 matched the key; 1 flagged/);
    const flagged = JSON.parse(await readFile(out("flagged.json"), "utf8"));
    assert.deepEqual(
      flagged.map((f) => [f.id, f.reasons]),
      [[3, ["disagree", "issue"]]],
    );
    assert.deepEqual(flagged[0].key, ["A"]);

    const refused = await run("apply", "--date", "2026-10-05");
    assert.equal(refused.code, 1);
    assert.match(refused.out, /Unresolved.*demo#3/);
    assert.equal(
      (await readBank()).questions[1].confidence,
      undefined,
      "nothing is written on refusal",
    );
  });

  test("apply with a verdict populates ratings, ids and bank totals", async () => {
    await writeFile(
      out("verdicts", "batch-01.json"),
      JSON.stringify([
        {
          bank: "demo",
          id: 3,
          verdict: "fix",
          reason:
            "Docs: reads are 0.1x; 1.25x is the 5-minute write. Name the operation in the stem.",
          sources: ["https://platform.claude.com/docs/en/build-with-claude/prompt-caching"],
          patch: {
            question: "Which pricing multiplier applies to a prompt-cache read (a cache hit)?",
          },
        },
      ]),
    );
    const { code, out: text } = await run("apply", "--date", "2026-10-05");
    assert.equal(code, 0, text);
    const b = await readBank();
    const [, two, three] = b.questions;
    assert.equal(two.confidence.rag, "green");
    assert.equal(two.source_id, 20002);
    assert.equal(three.confidence.rag, "amber");
    assert.equal(three.confidence.reworded, true);
    assert.match(three.question, /cache hit/);
    assert.equal(b.total_questions, 3);
    assert.deepEqual(b.actual_domain_distribution, { Tools: 0.6667, Agents: 0.3333 });
    assert.match(await readFile(out("summary.md"), "utf8"), /🟢 1 · 🟠 1 · 🔴 0/);

    const after = await run("diff");
    assert.match(after.out, /0 need review/);
  });

  test("keywords --write maps the new topic's question to its own section", async () => {
    const first = await run("keywords", "--write");
    assert.match(first.out, /Agent Loops: unmatched #2/);
    const g = JSON.parse(await readFile(src("demo_study_guide.json"), "utf8"));
    assert.ok(g.sections[1].keywords.length > 1);
    const second = await run("keywords");
    assert.match(second.out, /already maps to its topic/);
  });
});
