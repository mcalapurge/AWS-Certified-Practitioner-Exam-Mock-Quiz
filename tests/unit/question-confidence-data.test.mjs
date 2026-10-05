// Validates the per-question answer-confidence data in the prebuilt (Claude)
// source banks, and that the parser passes it through to the shipped data.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourcesDir = path.join(root, "scripts/sources");
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

const ANTHROPIC_DOCS =
  /^https:\/\/(platform\.claude\.com|code\.claude\.com|docs\.anthropic\.com|(www\.)?anthropic\.com)\//;

async function banks() {
  const files = (await readdir(sourcesDir)).filter((f) => f.endsWith("_practice_questions.json"));
  return Promise.all(
    files.map(async (f) => ({ file: f, data: await readJson(path.join(sourcesDir, f)) })),
  );
}

function check(c, where) {
  assert.ok(["green", "amber", "red"].includes(c.rag), `${where}: rag`);
  assert.ok(["high", "medium", "low"].includes(c.level), `${where}: level`);
  assert.ok(["docs", "reasoning"].includes(c.basis), `${where}: basis`);
  assert.equal(typeof c.timeSensitive, "boolean", `${where}: timeSensitive`);
  assert.match(c.reviewed, /^\d{4}-\d{2}-\d{2}$/, `${where}: reviewed`);
  if (c.reworded !== undefined) assert.equal(c.reworded, true, `${where}: reworded`);
  for (const u of c.sources ?? []) assert.match(u, ANTHROPIC_DOCS, `${where}: source ${u}`);
  // The rating must be consistent with the evidence behind it.
  if (c.rag === "green") {
    assert.equal(c.level, "high", `${where}: green needs high confidence`);
    assert.equal(c.basis, "docs", `${where}: green needs a docs basis`);
    assert.ok(c.sources?.length, `${where}: green needs at least one source`);
  }
  if (c.level === "low") assert.equal(c.rag, "red", `${where}: low confidence must be red`);
  if (c.basis === "docs") assert.ok(c.sources?.length, `${where}: docs basis needs sources`);
}

describe("answer-confidence data", () => {
  test("every rating in the source banks is well formed and self-consistent", async () => {
    let rated = 0;
    for (const { file, data } of await banks()) {
      for (const q of data.questions) {
        if (!q.confidence) continue;
        check(q.confidence, `${file}#${q.id}`);
        rated++;
      }
    }
    assert.ok(rated > 0, "at least one bank carries ratings");
  });

  test("every CCDV-F question has been rated", async () => {
    const data = await readJson(path.join(sourcesDir, "ccdvf_practice_questions.json"));
    const missing = data.questions.filter((q) => !q.confidence).map((q) => q.id);
    assert.deepEqual(missing, []);
  });

  test("the parser ships ratings unchanged in the generated quiz data", async () => {
    const source = await readJson(path.join(sourcesDir, "ccdvf_practice_questions.json"));
    const shipped = await readJson(
      path.join(root, "src/features/quiz/data/claude/developer-foundations.json"),
    );
    const byNumber = new Map(shipped.questions.map((q) => [q.number, q]));
    for (const q of source.questions) {
      assert.deepEqual(byNumber.get(q.id)?.confidence, q.confidence, `question ${q.id}`);
    }
  });
});
