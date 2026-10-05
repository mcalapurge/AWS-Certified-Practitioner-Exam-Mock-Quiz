---
name: check-data
description: >-
  Check the accuracy of the exam data's weak-topic mapping — whether a wrong
  answer actually lands in the right study-guide topic. Use this whenever the
  user wants to verify, audit, or measure the question/topic/keyword data, or
  after editing topic keywords, adding an exam, or syncing upstream content —
  phrasings like "check the data accuracy", "do the keywords match", "verify the
  weak-topic mapping", "will wrong answers show up under the right topic", "did
  my keyword change regress anything", or "audit the study guide tagging". The
  check compares the app's real keyword matching against the ground-truth topic
  each source question carries, and reports correct / wrong-topic / unmatched
  rates per exam.
---

# Check exam-data accuracy (weak-topic mapping)

The "weak topic" study-guide section is populated **only** by keyword matching.
When a quiz answer is wrong, `mapQuestionToTopics`
([src/features/study/lib/topics.ts](../../../src/features/study/lib/topics.ts))
regex-matches the question text (stem + options + explanation) against every
topic's `keywords` and flags the topics that hit. So the data is "accurate" only
if a wrong answer reliably flags the **correct** topic. Two failure modes:

- **Unmatched** — no keyword hits, so the wrong answer contributes nothing to the
  weak-topic section (the user is never pointed at what to study).
- **Mislabeled** — keywords for the wrong topic hit, so the user is pointed at the
  wrong study material.

Ground truth: every **prebuilt Claude exam** question in
`scripts/sources/*_practice_questions.json` carries an exact `topic` field that
maps 1:1 to a study-guide topic title. The checker compares the mapped topics to
that true topic. (AWS exams have no per-question topic tag — their `examSet` is
just the source filename — so they can't be checked this way and are skipped.)

## Step 1 — Make sure the generated data is fresh

The checker reads the **shipped/generated** files
(`src/features/study/data/topic-index.json` and
`src/features/quiz/data/<provider>/<examId>.json`). If you just edited keywords
in `scripts/sources/*_study_guide.json`, regenerate first or you'll validate
stale data:

```bash
npm run parse
```

## Step 2 — Run the check

```bash
npm run check-data
```

Or target one exam / see every failing question:

```bash
node scripts/check-topic-mapping.mjs developer-foundations --verbose
```

Flags: a bare `<examId>` checks just that exam; `--verbose` lists unmatched and
mislabeled question ids plus low-recall topics; `--min-correct=<pct>` and
`--max-wrong=<pct>` set the PASS/FAIL thresholds (defaults: correct ≥ 90%,
wrong-only ≤ 2%). Exit code is non-zero on failure, so it works as a regression
gate.

## Step 3 — Read the report

Per exam it prints:

- **correct topic flagged** — true topic is among the flagged topics (the number
  to maximize).
- **wrong topic only** — flagged topics but missed the true one (mislabeled;
  should be ~0%).
- **no match (lost)** — nothing flagged (wrong answer lost from the weak-topic
  section).
- **extra-flag** — correct, but also flagged another topic (minor noise; benign).
- **Low-recall topics** and, with `--verbose`, the exact unmatched / mislabeled
  question ids to target.

Healthy baseline (2026-10-05): `associate-foundations` 95.1% correct / 0%
wrong-only; `developer-foundations` 100% / 0%.

## Step 4 — If an exam fails, fix the keywords

The mapping is driven by each topic's `keywords` in the source study guide
(`scripts/sources/<prefix>_study_guide.json`), passed through verbatim by
`scripts/parse-sections.mjs`. To fix a low score, rebuild those keywords so they
**appear verbatim in the questions** and are **distinctive** to their topic
(the AWS path derives high-precision service-name keywords the same way — see
`deriveKeywords` in parse-sections.mjs; guiding rule: better to miss a topic than
flag the wrong one). The proven approach:

1. Group the source questions by their `topic` field (ground truth).
2. Mine 1–3 word phrases that are high-purity to each topic — appear in that
   topic's questions and few/no others — using a greedy set-cover to cover as
   many of the topic's questions as possible; prefer multi-word phrases; drop
   generic single words and tokenizer artifacts.
3. Write the phrases into the study-guide `keywords` arrays, `npm run parse`,
   then re-run this check against the regenerated data until correct ≈ 95–100%
   and wrong-only ≈ 0%.

**GOTCHA when scoring candidate keywords:** the matcher treats every
non-alphanumeric char (including `-` and `_`) as a word boundary, so the keyword
`well` matches `well-written` and `message` matches `message_start` at runtime.
Score candidate purity/coverage with that **same regex** (`buildPattern` in
topics.ts / this checker), not a tokenizer that keeps hyphens/underscores inside
tokens — otherwise generic words leak in and over-match.

## Gotchas

- **Only Claude (prebuilt) exams are checkable.** AWS exams lack per-question
  topic tags; a fresh exam is auto-discovered only if its
  `scripts/sources/<prefix>_practice_questions.json` has a `topic` field per
  question and a sibling `<prefix>_study_guide.json` with the matching `examId`.
- **Generated data is derived** — the checker validates it, but fix accuracy by
  editing the source study-guide keywords and re-parsing, never by hand-editing
  `topic-index.json` or the `data/` JSON.
- **Keep the checker in sync with topics.ts.** `buildPattern`/`haystackOf` in
  `scripts/check-topic-mapping.mjs` mirror the app matcher; the script prints a
  warning if topics.ts changes in a way that breaks that assumption.
