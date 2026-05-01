# AWS Exam Practice

Interactive React app for practicing the **AWS Certified Cloud Practitioner (CLF-C02)** and
**AWS Certified AI Practitioner (AIF-C01)** exams. Reads study notes and practice questions
from local markdown sources and turns them into a configurable quiz with an adaptive,
checkbox-driven study guide.

> **Heads-up:** this app is a UI on top of community-maintained question banks and study notes.
> All credit for the underlying content goes to [@kananinirav](https://github.com/kananinirav).
> See [Acknowledgements](#acknowledgements).

## Features

- **Two exams in one app** — Cloud Practitioner (1,142 questions, 19 study topics) and AI
  Practitioner (346 questions, 28 topics).
- **Configurable quiz** — pick exam, length (preset or custom), shuffle, and feedback mode:
  - **Instant** — submit each answer, see correct/incorrect immediately with explanations.
  - **Submit at end** — exam-style; results revealed only after submission.
- **Multi-select** questions are auto-detected from the source markdown (handles `BC`,
  `B and D`, `B, C` etc.).
- **Persistence** — quiz progress, history, and study guide all saved to `localStorage`.
  Close the tab and resume later.
- **Results review** — filterable by all / correct / incorrect, with explanations and
  clickable links inline.
- **Study notes** — full markdown notes per topic with table of contents, lazy-loaded so
  the practice flow stays light.
- **Adaptive study guide** — every incorrect answer is mapped to one or more study topics
  (via auto-derived keyword indexes). Topics flagged this way appear at the top of the
  study sidebar with a checkbox to mark mastered, and a count badge for recurring
  weaknesses. Instant-mode flags topics in real time as you lock answers; submit-at-end
  mode flags them when you finalize the quiz.

## Run it locally

The two upstream content repos are wired in as **git submodules**, so a recursive clone
pulls everything in one step:

```sh
git clone --recurse-submodules <this repo>
cd <this repo>
npm install
npm run dev
```

Then open <http://localhost:5173>.

If you already cloned without `--recurse-submodules`, hydrate them now:

```sh
git submodule update --init --recursive
```

To bump the pinned upstream commits later (when [@kananinirav](https://github.com/kananinirav)
adds new questions or notes):

```sh
git submodule update --remote
npm run parse              # regenerate JSON from the new sources
git add -A && git commit   # commit the pin bump + regenerated JSON
```

The parsers (`scripts/parse-questions.mjs` and `scripts/parse-sections.mjs`) walk the
submodule trees at build time. If the submodules aren't initialized, they log a warning
and the build falls back to the JSON already committed under
`src/features/{quiz,study}/data/`.

## Production build

```sh
npm run build      # tsc --noEmit && vite build → dist/
npm run preview    # serve the production bundle locally
```

The build output goes to `dist/` and can be deployed to any static host (S3, Netlify,
Vercel, GitHub Pages). A GitHub Actions workflow that pushes to S3 is included at
`.github/workflows/main.yaml` — it runs on commits to `main` whose message contains
`[deploy]`.

## Tech stack

- **React 19** + **TypeScript** (strict)
- **Vite 5** with route-level code splitting
- **Tailwind CSS v4** via `@tailwindcss/vite` + the typography plugin (no `tailwind.config.*`)
- **shadcn/ui** primitives (`new-york` style) on top of **Radix UI**
- **react-markdown** + **remark-gfm** for the study-notes viewer
- `localStorage` for all persistence — no backend, no cookies

## Project structure

```
.
├── scripts/
│   ├── parse-questions.mjs       # markdown → src/features/quiz/data/*.json
│   └── parse-sections.mjs        # markdown → src/features/study/data/*.json
├── src/
│   ├── App.tsx                   # thin shell — view switching
│   ├── components/ui/            # shadcn primitives
│   ├── lib/utils.ts              # cn() helper
│   └── features/
│       ├── quiz/                 # setup, quiz screen, results, scoring, persistence
│       └── study/                # notes viewer, topic index, adaptive study guide
└── .github/workflows/main.yaml   # deploy to S3
```

See [`AGENTS.md`](./AGENTS.md) for a deeper map of conventions and how to add a new exam.

## Acknowledgements

This app is a renderer — every practice question, study note, and explanation comes from
two open-source repos by **[Nirav Kanani (@kananinirav)](https://github.com/kananinirav)**:

| Source | Used for | License |
|---|---|---|
| [AWS-Certified-Cloud-Practitioner-Notes](https://github.com/kananinirav/AWS-Certified-Cloud-Practitioner-Notes) | CLF-C02 practice questions and study notes | See repo |
| [aws-certified-ai-practitioner-study-notes](https://github.com/kananinirav/aws-certified-ai-practitioner-study-notes) | AIF-C01 practice questions and study notes | See repo |

If you find the content useful, please **⭐ star the source repos** above and consider
contributing fixes or new questions back to them. This app is just an interactive shell
on top of their work.

> The license terms of the source content take precedence; if the upstream license
> changes, the same terms apply to the question/section data shipped in this app.

## Disclaimer

The questions and notes are unofficial, community-curated study material. They are not
affiliated with, endorsed by, or sponsored by Amazon Web Services, Inc. Use them as
preparation, not as a substitute for the official AWS exam guides.
