---
name: deploy
description: >-
  Ship the app to production (S3 via GitHub Actions). Use this whenever the user
  wants to deploy, release, publish, or "ship it" / "push it live" / "put it on
  prod". Deployment is gated by a non-obvious convention — the GitHub Actions
  workflow only runs when a commit pushed to `main` has `[deploy]` in its
  message — so a normal push does nothing with no error. Follow this skill so
  the deploy actually triggers, the build is verified first (CI has no test or
  lint gate), and the push to main is confirmed before it goes out.
---

# Deploy to production

Deploys are driven by [.github/workflows/main.yaml](../../../.github/workflows/main.yaml).
Two conditions must both hold for it to run:

1. the push is to the **`main`** branch, and
2. the triggering commit's message **contains the literal string `[deploy]`**.

If either is missing, nothing happens — and there's no error to tell you so.
That's the single biggest footgun this skill exists to prevent. On a qualifying
push, CI checks out with submodules, runs `npm run build`, and
`aws s3 sync ./dist … --delete` to the production bucket.

Pushing to `main` publishes a public site and the `--delete` sync removes files
no longer in `dist/`. It is outward-facing and effectively irreversible, so
**always get an explicit yes from the user before the push** (see the safety
rules). Do not generalize one approval to a later deploy.

## Step 1 — Pre-flight: build locally

CI has no test or lint stage — `npm run build` is the *only* gate, so a build
that fails there fails the whole pipeline after you've already pushed. Catch it
locally first:

```bash
npm run build
```

This runs `tsc --noEmit && vite build` (with `npm run parse` via `prebuild`). It
must pass cleanly before you go further. If it fails, fix it and do not deploy.

## Step 2 — Confirm branch and state

```bash
git status -sb
```

Confirm the user is on `main` (or intends to merge to it) and that the working
tree holds only what they mean to ship. If they're on a feature branch, deciding
how it reaches `main` (merge? PR?) is the user's call — ask rather than assume.

## Step 3 — Create the `[deploy]` commit

- **If there are staged/unstaged changes to ship**, commit them with `[deploy]`
  in the message:
  ```bash
  git commit -m "[deploy] <what changed>"
  ```
- **If everything is already committed** and you just want to trigger a deploy
  of the current `main`, the workflow keys off the *head commit's* message, so
  add a `[deploy]` commit on top. An empty commit is the clean way:
  ```bash
  git commit --allow-empty -m "[deploy] redeploy current main"
  ```

Follow the repo's existing style — recent deploys use messages like
`chore: [deploy] …`. The tag can sit anywhere in the message.

## Step 4 — Confirm, then push

Summarize what's about to happen and get an explicit yes before pushing —
this is the irreversible, outward-facing step:

> Ready to deploy to production: pushing `<commit summary>` to `main`, which
> triggers the S3 sync (with `--delete`). Confirm?

On a clear yes:

```bash
git push origin main
```

## Step 5 — Watch the run

If the `gh` CLI is available, follow the workflow so you can report success or
surface a failure rather than leaving the user guessing:

```bash
gh run watch --exit-status || gh run view --log-failed
```

Report the outcome plainly — deployed and green, or failed with the relevant log
excerpt.

## Gotchas

- **No `[deploy]`, no deploy.** A plain push to `main` runs nothing and prints
  no error. If a user says "I pushed but it didn't deploy", check the head
  commit message for the tag first.
- **Only `main` deploys.** Tagging a commit on a feature branch does nothing
  until it lands on `main` as the head commit.
- **`--delete` sync.** Anything not in `dist/` is removed from the bucket. The
  build produces `dist/`, so this is normal — just know the sync is destructive
  toward stale objects.
- **CI is the only gate.** No tests, no lint — Step 1's local build is your real
  safety check.
