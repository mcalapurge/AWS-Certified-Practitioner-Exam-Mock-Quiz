// Guards the prebuilt (Claude) source banks against an answer-length tell: if
// the keyed option is usually the longest (or usually any one length rank),
// a test-taker can score well by length alone without knowing the material.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  keyLengthRanks,
  longestKeyedShare,
  LONGEST_KEYED_MAX,
} from "../../scripts/review-questions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourcesDir = path.join(root, "scripts/sources");

const files = (await readdir(sourcesDir)).filter((f) => f.endsWith("_practice_questions.json"));
const pct = (n, d) => `${n}/${d} (${Math.round((n / d) * 100)}%)`;

for (const file of files) {
  const { questions } = JSON.parse(await readFile(path.join(sourcesDir, file), "utf8"));

  test(`${file}: the key is not usually the longest option`, () => {
    const { longest, single } = longestKeyedShare(questions);
    assert.ok(
      longest / single <= LONGEST_KEYED_MAX,
      `the keyed option is the longest in ${pct(longest, single)}; keep it at or below ${LONGEST_KEYED_MAX * 100}% by trimming keys or lengthening distractors`,
    );
  });

  test(`${file}: no option length rank gives the key away`, () => {
    const { ranks, single } = keyLengthRanks(questions);
    ranks.forEach((n, i) =>
      assert.ok(
        n / single <= LONGEST_KEYED_MAX,
        `the keyed option has ${i} longer option(s) in ${pct(n, single)}; vary which option is longest`,
      ),
    );
  });
}
