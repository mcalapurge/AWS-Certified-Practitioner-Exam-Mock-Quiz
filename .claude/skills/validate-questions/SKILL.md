---
name: validate-questions
description: >-
  Validate the practice questions added or changed in a git diff (a PR/MR, a
  branch, a commit range, or uncommitted work) and populate the data that goes
  with them. Use this whenever the user wants new or edited questions checked
  before they ship — phrasings like "validate the new questions", "check the
  questions in this PR/MR", "review the questions I added", "are the answers in
  this diff right", "rate the new questions", "fill in the confidence for the
  new questions", or "did my question edits break anything". It lints each
  question, has subagents answer them blind and check the facts against
  Anthropic's docs, adjudicates disagreements, then writes the confidence
  (RAG) rating, source ids, bank totals and topic keywords back into the source
  data and regenerates everything derived from it.
---

# Validate questions in a diff

Prebuilt (Claude) exam questions live in
`scripts/sources/<prefix>_practice_questions.json`. Every one should carry a
`confidence` rating earned by an independent blind review (see AGENTS.md →
"Answer confidence (RAG)"). This skill finds the questions a piece of work adds
or changes and takes them through the same review as the full audit. It is
driven by `scripts/review-questions.mjs` (`npm run questions -- <command>`).

**What gets populated**, so nothing is left for a human to fill in by hand:

| Data                                                                                      | Where                             | Step               |
| ----------------------------------------------------------------------------------------- | --------------------------------- | ------------------ |
| `confidence` (rag, level, basis, sources, timeSensitive, reworded, reviewed, contentHash) | each reviewed question            | `apply`            |
| fixes and re-keys from adjudication                                                       | each patched question             | `apply`            |
| `source_id` for new questions (20000 + id)                                                | each new question                 | `apply`            |
| `total_questions`, `actual_domain_distribution`                                           | the bank's header                 | `apply`            |
| topic `keywords`, so a wrong answer maps to the right topic                               | `<prefix>_study_guide.json`       | `keywords --write` |
| generated quiz and study data                                                             | `src/features/{quiz,study}/data/` | `npm run parse`    |
| question and section counts                                                               | AGENTS.md, the bank's `note`      | Step 7 (by hand)   |

AWS exams aren't covered: their questions come from read-only markdown
submodules and carry no ratings.

## Step 0 — Pick the scope

The scope is everything between a **base ref** and the **working tree**,
including uncommitted edits.

- **Current branch or PR (default):** no flag. The base is the merge-base with
  `origin/main`. Run `git fetch origin main` first so it's current.
- **A specific PR/MR:** look up its base branch (GitHub MCP
  `pull_request_read` → `base.ref`, or ask), check out its head branch, then
  run `git fetch origin <base>` and pass `--base origin/<base>`.
- **A commit range or other piece of work:** pass `--base <ref>`, e.g.
  `--base HEAD~3` or `--base v1.2.0`.

## Step 1 — Diff and lint

```bash
npm run questions -- diff [--base <ref>] [--verbose]
```

Per bank, this prints the counts of added, changed (question, options, key or
explanation), retagged and removed questions. It then lists each question that
**needs review**, and why:

- **No confidence rating:** a new question, or a bank that was never reviewed.
- **Content changed after it was last rated:** the rating predates an edit,
  either from the base or from an earlier commit in this same piece of work.

Retags (domain, topic or difficulty only) don't need a review. `--all`
re-reviews every added or changed question regardless.

**Lint errors fail the command. Fix them before going on**:

- options other than exactly A–D;
- a key letter that isn't an option;
- a multi-select stem that doesn't say "Select the TWO …";
- a multi-select item that isn't tagged Analysis;
- a domain that isn't in `domain_weights`;
- a topic with no study-guide section of that title (add the section first, as
  in AGENTS.md → "Adding a new exam");
- duplicate questions;
- a malformed rating.

**Warnings** (`--verbose` lists them) are worth fixing in new questions:

- the keyed option is far longer than every distractor;
- the stem is nearly identical to another question;
- "all/none of the above" options;
- exam-meta wording;
- a very short explanation.

The bank-level warning that the keyed option is the longest in X/Y questions
matters most. With four options, chance is 25%; well above that, "pick the
longest" beats knowing the material. Across a whole bank, `lint` and the unit
tests fail above 40% (`LONGEST_KEYED_MAX`), and no other length rank may exceed
that either, so don't fix it by making every key the second-longest.

If nothing needs review, skip to Step 6: the keyword and parse steps still
apply to retags and new topics.

## Step 2 — Prepare blind batches

```bash
npm run questions -- prepare [--base <ref>] [--batch-size 15]
```

This writes `report/question-review/` (gitignored):

- `manifest.json`: the scope, plus a content hash per item so `apply` can tell
  if a question was edited mid-review;
- `blind/batch-NN.json`: each item's bank, id, `select`, question and options.
  There's **no key, explanation, topic or rating**.

## Step 3 — Blind review with subagents

Launch one subagent per `blind/` batch, **all at once in the background**. Use
the `general-purpose` type, because it needs WebFetch/WebSearch, Read and
Write. Build each prompt from [reviewer-prompt.md](reviewer-prompt.md),
filling in `{EXAM}` (the bank's `exam` field), `{TODAY}`, and absolute
`{INPUT}`/`{OUTPUT}` paths (`blind/batch-NN.json` → `answers/batch-NN.json`).

Rules that keep the review honest:

- **Never** put the key, the explanation or the topic into a reviewer prompt,
  or tell a reviewer what you expect. The point is an independent answer.
- Reviewers verify facts against Anthropic's docs (platform.claude.com,
  code.claude.com, anthropic.com). Other sources are dropped when ratings are
  derived, so only Anthropic docs can earn a green.
- 15 questions per batch keeps each reviewer's research focused. For one or
  two questions, a single subagent is fine.

When they've all finished, check that every batch has an answers file. Re-run
any reviewer that failed or wrote invalid JSON.

## Step 4 — Compare, then adjudicate what was flagged

```bash
npm run questions -- compare
```

This scores each answer against the key and writes the flagged items, with the
key, explanation and the reviewer's notes, to `adjudicate/batch-NN.json` (and
all of them to `flagged.json`). An item is flagged when:

- the reviewer **disagreed** with the key;
- the reviewer had **low confidence**;
- the reviewer raised an **issue**;
- the reviewer matched the key but thought **another option was also
  defensible**.

The command exits 1 if any answer is missing or invalid.

For each `adjudicate/` file, launch a `general-purpose` subagent with
[adjudicator-prompt.md](adjudicator-prompt.md) (`adjudicate/batch-NN.json` →
`verdicts/batch-NN.json`). Each item gets one of four verdicts:

- `keep`: the key and wording stand as they are.
- `fix`: the key is right, but the wording needs a minimal patch.
- `rekey`: the key is wrong; the verdict carries `patch.correct`.
- `dispute`: no single defensible answer; the question is rated red.

Read every verdict yourself before applying it. A `rekey` changes what users
are taught. Check its reason and sources, and tell the user about each one.

## Step 5 — Apply

```bash
npm run questions -- apply [--date YYYY-MM-DD]
```

For each reviewed question, `apply` patches it, derives its rating, fills a
missing `source_id`, and refreshes the bank's totals and domain mix. It then
re-lints the result and writes the bank, formatted with prettier. A summary
goes to `report/question-review/summary.md` and `summary.json`.

Ratings follow the same rules the unit tests enforce:

| Outcome                                                                             | Rating           |
| ----------------------------------------------------------------------------------- | ---------------- |
| Matched blind, high confidence, confirmed in Anthropic docs                         | 🟢 green         |
| Matched, but judgement-based or medium confidence                                   | 🟠 amber         |
| Disagreement or low confidence that the adjudicator resolved (`keep`/`fix`/`rekey`) | 🟠 amber, medium |
| `dispute`, or an unresolved disagreement or low confidence                          | 🔴 red, low      |

Only the blind reviewer's own doc check earns a docs basis. The adjudicator's
sources are recorded, but they only count toward the basis when they settled a
disagreement, so a judgement call never turns green on a second opinion.
`reworded: true` is set whenever a patch landed. `timeSensitive` comes from the
adjudicator if there is one, otherwise from the reviewer. `contentHash` records the
content that was rated, so `diff` treats a re-review as current even when its
rating (and date) came out identical to the old one.

`apply` refuses to run, and writes nothing, when any of these is true:

- an item has no answer;
- a disagreement or low-confidence item has no verdict. Pass
  `--allow-unresolved` to rate those red deliberately;
- a question changed after `prepare`. Re-run from Step 2.

## Step 6 — Populate derived data and verify

```bash
npm run questions -- keywords --write   # topic keywords for any question in scope that doesn't map to its own topic
npm run parse                           # regenerate src/features/{quiz,study}/data
npm run check-data                      # weak-topic mapping still ≥ 90% correct, ≤ 2% wrong-only
npm run questions -- diff               # expect "0 need review" and no lint errors
npm run ci                              # prettier, typecheck, unit tests (incl. confidence rules)
npm run report                          # coverage report; check the confidence counts
```

`keywords` only adds phrases that appear in the unmatched question and in no
question filed under another topic, so it can't mislabel anything. It prints
`! no pure keyword` when it can't find one; then add a distinctive phrase by
hand, using the `check-data` skill's method.

`npm run parse` also rewrites the generated AWS and CCAO data with fresh
timestamps. Restore any of those files you didn't mean to change with
`git checkout -- src/features/quiz/data src/features/study/data`, then re-run
`npm run parse` for the bank you did change.

## Step 7 — Update counts and report back

- If the question or section count changed, update AGENTS.md ("N questions +
  M study sections") and the bank's `note` if the work was a coverage pass.
- Report to the user:
  - the green/amber/red tally from `summary.md`;
  - every `fix`, `rekey` and `dispute` with its reason;
  - any red question left in the bank;
  - the length-tell warning, if it fired.

## Gotchas

- **The review folder sits inside the repo**, and the key is one directory
  away. Reviewer prompts forbid reading anything but the input file. Keep that
  rule in any prompt you write. To be safer, pass `--out <scratchpad dir>` to
  every command so the batches live outside the checkout.
- **Don't hand-edit `confidence`.** A rating is evidence of a review. Re-run
  the skill instead (`--all` to force it). The unit test
  `question-confidence-data` rejects a green rating without docs sources.
- **Edits after `prepare` invalidate the batch.** `apply` checks content
  hashes and refuses to rate a question the reviewer never saw.
- **IDs:** a new question takes the next unused `id` in its bank. `apply` fills
  `source_id` as 20000 + id, or the next free value.
- **A new topic needs a study-guide section first.** Lint fails on a topic
  with no section of that title, and `keywords` can't help until the section
  exists.
