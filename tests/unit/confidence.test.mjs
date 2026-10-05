// Loads the app's TypeScript helper directly; Node strips the type-only imports.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  RAG_LEGEND,
  describeConfidence,
  formatReviewed,
  sourceTitle,
} from "../../src/features/quiz/lib/confidence.ts";

const base = {
  rag: "green",
  level: "high",
  basis: "docs",
  timeSensitive: false,
  reviewed: "2026-10-05",
};

describe("describeConfidence", () => {
  test("green reads as verified against the docs", () => {
    const v = describeConfidence(base);
    assert.equal(v.rag, "green");
    assert.equal(v.label, "Verified");
    assert.match(v.headline, /Anthropic's docs/);
    assert.match(v.summary, /without seeing the key/);
    assert.deepEqual(v.notes, []);
    assert.equal(v.reviewedLabel, "Oct 2026");
  });

  test("amber with high confidence is a best-practice judgement", () => {
    const v = describeConfidence({ ...base, rag: "amber", basis: "reasoning" });
    assert.equal(v.label, "Best practice");
    assert.match(v.summary, /judgement/);
  });

  test("amber with medium confidence warns that another option may be arguable", () => {
    const v = describeConfidence({ ...base, rag: "amber", level: "medium" });
    assert.equal(v.label, "Reviewed, with caveats");
    assert.match(v.summary, /medium confidence/);
  });

  test("red reads as disputed", () => {
    const v = describeConfidence({ ...base, rag: "red", level: "low", basis: "reasoning" });
    assert.equal(v.label, "Disputed");
    assert.match(v.summary, /caution/);
  });

  test("reworded and time-sensitive questions carry notes, in that order", () => {
    const v = describeConfidence({ ...base, reworded: true, timeSensitive: true });
    assert.equal(v.notes.length, 2);
    assert.match(v.notes[0], /Reworded after review/);
    assert.match(v.notes[1], /as of Oct 2026/);
    assert.match(v.notes[1], /live exam may still expect the older behaviour/);
  });

  test("an unparseable review date drops the date rather than inventing one", () => {
    const v = describeConfidence({ ...base, reviewed: "recently", timeSensitive: true });
    assert.equal(v.reviewedLabel, null);
    assert.match(v.notes[0], /platform behaviour\. The live exam/);
  });
});

describe("RAG_LEGEND", () => {
  test("covers each status once, with labels matching the inline footnote", () => {
    assert.deepEqual(
      RAG_LEGEND.map((l) => l.rag),
      ["green", "amber", "red"],
    );
    assert.equal(RAG_LEGEND[0].label, describeConfidence(base).label);
    assert.equal(
      RAG_LEGEND[1].label,
      describeConfidence({ ...base, rag: "amber", basis: "reasoning" }).label,
    );
    assert.equal(RAG_LEGEND[2].label, describeConfidence({ ...base, rag: "red" }).label);
  });
});

describe("formatReviewed", () => {
  test("formats ISO dates without timezone drift", () => {
    assert.equal(formatReviewed("2026-01-01"), "Jan 2026");
    assert.equal(formatReviewed("2026-12-31"), "Dec 2026");
  });
  test("rejects malformed dates", () => {
    assert.equal(formatReviewed("2026-13-01"), null);
    assert.equal(formatReviewed("05/10/2026"), null);
  });
});

describe("sourceTitle", () => {
  test("turns a docs URL into a readable link label", () => {
    assert.equal(
      sourceTitle("https://platform.claude.com/docs/en/build-with-claude/prompt-caching"),
      "Prompt caching",
    );
    assert.equal(sourceTitle("https://code.claude.com/docs/en/sub-agents"), "Sub agents");
  });
  test("falls back to the host, then to the raw string", () => {
    assert.equal(sourceTitle("https://www.anthropic.com/"), "www.anthropic.com");
    assert.equal(sourceTitle("not a url"), "not a url");
  });
});
