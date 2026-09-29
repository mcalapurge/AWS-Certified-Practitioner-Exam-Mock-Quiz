---
name: sync-upstream
description: >-
  Refresh the AWS content from its upstream git submodules and regenerate the
  app's question/section data. Use this whenever the user wants to pull the
  latest questions or study notes, bump the submodule pins, or sync upstream
  content — phrasings like "update the submodules", "pull the latest questions",
  "refresh the AWS notes", "bump the upstream pins", "get new questions from
  kananinirav", or "the upstream repo added questions, sync them in". The
  submodules are READ-ONLY upstream mirrors and the correct refresh is a
  specific update → parse → review → commit cycle; follow this skill so you
  don't accidentally commit edits inside a submodule or ship a silent data drop.
---

# Sync upstream content

The two AWS exams are backed by read-only git submodules at the repo root
(see [.gitmodules](../../../.gitmodules)):

- `AWS-Certified-Cloud-Practitioner-Notes/` (CLF-C02)
- `aws-certified-ai-practitioner-study-notes/` (AIF-C01)

The Claude exam (`developer-foundations`) has **no submodule** — its content is
hand-authored JSON in `scripts/sources/` and is unaffected by this skill.

Refreshing means: bump the pinned upstream commit, regenerate the JSON the app
ships, sanity-check that nothing silently dropped, then commit the pin bump +
regenerated data together. The key invariant: **never edit or commit files
inside a submodule** — fixes to questions/notes go upstream to
[@kananinirav](https://github.com/kananinirav), not here.

## Step 1 — Make sure submodules are initialized

```bash
git submodule status
```

If paths show a leading `-` they aren't hydrated yet:

```bash
git submodule update --init --recursive
```

## Step 2 — Bump the pins

Update all submodules, or name one to update just it:

```bash
git submodule update --remote
```

This moves each submodule's checked-out commit to the latest on its tracked
branch, which shows up in the parent repo as a staged gitlink change (the commit
pointer). That staged pointer change is expected and correct — it is _not_ an
edit to files inside the submodule.

## Step 3 — Regenerate the data

```bash
npm run parse
```

Rewrites `src/features/{quiz,study}/data/<provider>/*.json` plus `meta.json`
and `topic-index.json` from the freshly-updated sources.

## Step 4 — Review the diff before committing (the important part)

1. See what moved:
   ```bash
   git status
   git diff --submodule=log
   ```
2. **Check counts didn't unexpectedly drop.** Compare the `questionCount` /
   `sectionCount` in the regenerated `meta.json` and per-exam JSON against the
   previous version:
   ```bash
   git diff src/features/quiz/data/meta.json
   ```
   A large or total drop for an exam is a red flag: upstream may have changed
   the markdown format so the parser silently dropped blocks (`parseBlock`
   returns `null` for anything it can't parse an answer out of). If counts fell,
   investigate `scripts/parse-questions.mjs` (`parseAnswerTail` / `parseBlock`)
   against the new source markdown before committing — don't ship a regression.
3. **Confirm no edits leaked into the submodule trees.** The only submodule
   change should be the pointer bump, never modified files _inside_ them:
   ```bash
   git -C AWS-Certified-Cloud-Practitioner-Notes status --short
   git -C aws-certified-ai-practitioner-study-notes status --short
   ```
   These should be clean. If they show modified files, you (or a tool) edited
   upstream content — revert it and send the fix upstream instead.

## Step 5 — Commit

Stage the pin bump(s) and the regenerated JSON together so the data always
matches the pinned sources:

```bash
git add .gitmodules AWS-Certified-Cloud-Practitioner-Notes aws-certified-ai-practitioner-study-notes src/features
git commit -m "chore: bump upstream submodules and regenerate exam data"
```

Adjust the staged submodule paths to whichever you actually bumped. Confirm the
commit message with the user first if they have a convention in mind.

Committing here does not deploy; pushing to `main` does (see the `deploy`
skill), so only push to `main` when the user wants this change live.

## Gotchas

- **Submodules are upstream mirrors, not editable content.** If a question is
  wrong, the fix is a PR to the source repo, then a pin bump here — not a local
  edit. Any modified file _inside_ a submodule is a mistake.
- **A silent count drop is the failure mode to watch for.** The build stays
  green even if the parser drops questions, so Step 4's count check is the only
  thing standing between an upstream format change and shipping fewer questions.
- **Regenerated `data/` JSON is derived** — review it, but don't hand-edit it.
