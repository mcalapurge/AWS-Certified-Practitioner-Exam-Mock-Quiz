# CLAUDE.md

See [AGENTS.md](./AGENTS.md) for full project guidance — repo layout, the
React 19 + Vite + Tailwind v4 + shadcn/ui stack, folder conventions, the
markdown-to-JSON parser flow, the adaptive study-guide model, and rules to
follow when modifying state or styling.

## Quick orientation

- This repo IS the React app. The two upstream content sources by
  [@kananinirav](https://github.com/kananinirav)
  (`AWS-Certified-Cloud-Practitioner-Notes` and
  `aws-certified-ai-practitioner-study-notes`) are wired in as **git
  submodules** at the repo root and are read-only. Don't commit edits inside
  them — send fixes upstream and bump the pin with
  `git submodule update --remote`.
- Run from this repo's root: `npm run dev`, `npm run build`, `npm run parse`.
  `predev`/`prebuild` regenerate JSON automatically.
- Use the `@/*` import alias for everything under `src/`.
- Quiz state is owned by `src/features/quiz/hooks/useQuiz.ts`. Update it
  through that hook's actions and pure helpers — don't reach around it.
- Style with Tailwind utilities + the `cn()` helper from `@/lib/utils`. Theme
  tokens live in `src/index.css`.
- Add shadcn primitives via `npx shadcn@latest add <name>` (respects
  `components.json`).
