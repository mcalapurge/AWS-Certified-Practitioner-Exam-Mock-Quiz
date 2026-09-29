---
name: deploy
description: >-
  Ship the app to production (S3 via GitHub Actions). Use this whenever the user
  wants to deploy, release, publish, or "ship it" / "push it live" / "put it on
  prod". Every push to `main` deploys (after a CI workflow runs on all pushes),
  so follow this skill to verify locally with `npm run ci` and `npm run build`
  and to confirm the push to main before it goes out.
---

# Deploy to production

CI is [.github/workflows/ci.yaml](../../../.github/workflows/ci.yaml): on every
push it runs `npm run format:check`, `npm run typecheck` and `npm run check-data`.
CD is [.github/workflows/main.yaml](../../../.github/workflows/main.yaml): on every
push to **`main`** it builds and runs `aws s3 sync ./dist … --delete` to the
production bucket. There is no commit-message gate.

Pushing to `main` publishes a public site and the `--delete` sync removes files
no longer in `dist/`. It is outward-facing and effectively irreversible, so
**always get an explicit yes from the user before the push**. Do not generalize
one approval to a later deploy.

## Step 1 — Pre-flight locally

```bash
npm run ci      # prettier check + typecheck (npm run format fixes style)
npm run check-data
npm run build
```

All must pass. If any fails, fix it and do not push to `main`.

## Step 2 — Confirm branch and state

```bash
git status -sb
```

Confirm the working tree holds only what the user means to ship. How a feature
branch reaches `main` (merge? PR?) is the user's call — ask rather than assume.

## Step 3 — Confirm, then push

> Ready to deploy to production: pushing `<commit summary>` to `main`, which
> triggers the S3 sync (with `--delete`). Confirm?

On a clear yes: `git push origin main`, then watch the Actions run and report the
outcome plainly.

## Gotchas

- **Every push to `main` deploys**, even docs-only ones, if CI/build succeed.
- **`--delete` sync.** Anything not in `dist/` is removed from the bucket.
- CI failures on `main` don't block the deploy workflow (they're separate
  workflows), so verify locally first.
