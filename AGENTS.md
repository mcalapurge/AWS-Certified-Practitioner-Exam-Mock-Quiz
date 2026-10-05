# AGENTS.md

Guidance for AI coding agents (Claude Code, Cursor, Codex, etc.) working in this repo.

## What this repo is

A quiz + study app that doubles as two differently-branded exam-prep tools
switched via an **AWS ⇄ Claude toggle** (`useProvider`, header `Tabs`): AWS
certification content sourced from two community-maintained markdown
collections by [@kananinirav](https://github.com/kananinirav), and two
Claude-certification exams (CCDV-F and CCAO-F) sourced from prebuilt JSON
files. Switching providers changes the visual theme (`.theme-claude` in
`src/index.css`), which exams are selectable, and which data loads — see
"Provider switch" below.

The two AWS content repos are wired in as **git submodules** at the repo root:

- [`AWS-Certified-Cloud-Practitioner-Notes`](https://github.com/kananinirav/AWS-Certified-Cloud-Practitioner-Notes)
  — submodule path `AWS-Certified-Cloud-Practitioner-Notes/`
  - `practice-exam/*.md` — 1,142 CLF-C02 practice questions.
  - `sections/*.md` — 19 study notes covering the exam topics.
- [`aws-certified-ai-practitioner-study-notes`](https://github.com/kananinirav/aws-certified-ai-practitioner-study-notes)
  — submodule path `aws-certified-ai-practitioner-study-notes/`
  - `practice-test/*.md` — 346 AIF-C01 practice questions.
  - `section/<category>/*.md` — 28 study notes grouped by category.

The Claude content has no submodule — it's static, hand-curated JSON committed
under `scripts/sources/`, one `_practice_questions.json` + `_study_guide.json`
pair per exam:

- `ccdvf_practice_questions.json` + `ccdvf_study_guide.json` — Claude Certified
  Developer – Foundations (CCDV-F): 467 questions + 90 study sections.
- `ccao_practice_questions.json` + `ccao_study_guide.json` — Claude Certified
  Associate – Foundations (CCAO-F): 487 questions + 37 study sections.

Two parsers under `scripts/` build the datasets the app consumes, each
handling both the markdown-sourced (submodule) exams and the prebuilt-JSON
(Claude) exams. Output is split into a per-provider subfolder:

- `parse-questions.mjs` → `src/features/quiz/data/<provider>/<exam>.json` + `meta.json`
- `parse-sections.mjs` → `src/features/study/data/<provider>/<exam>.json` + `topic-index.json`

Both run automatically before `dev` and `build`. **The submodule directories
are read-only upstream content** — do not commit changes inside them. If a
question or note needs fixing, the change should be sent upstream to the source
repos above and pulled in via `git submodule update --remote`.

## Top-level layout

```
.
├── .gitmodules                                     # submodule pins
├── .github/workflows/ci.yaml                       # CI on every push — prettier, typecheck, unit tests, check-data, build, report, e2e
├── .github/workflows/main.yaml                     # CD on push to main — build + S3 deploy
├── .claude/skills/                                 # repo workflows: add-exam, check-data, sync-upstream, validate-questions
├── AGENTS.md                                       # this file
├── CLAUDE.md                                       # pointer to AGENTS.md
├── LICENSE                                         # MIT
├── README.md
├── AWS-Certified-Cloud-Practitioner-Notes/         # submodule — read-only upstream
├── aws-certified-ai-practitioner-study-notes/      # submodule — read-only upstream
├── scripts/                                        # markdown/JSON → app-data parsers, data check, coverage report
│   └── sources/                                    # static source JSON for prebuilt exams (Claude)
└── src/                                            # the React app
```

`scripts/parse-questions.mjs` and `scripts/parse-sections.mjs` resolve upstream
paths relative to the repo root (`path.resolve(__dirname, "..", "<submodule>")`).
If the submodules aren't initialized (e.g. CI checkout without
`submodules: recursive`), the parsers log a warning, exit 0, and the build uses
the JSON already committed under `src/features/{quiz,study}/data/`. The
[GitHub Actions workflow](./.github/workflows/main.yaml) sets `submodules:
recursive` on `actions/checkout` so the parsers see fresh sources on every CI run.

## Tech stack

- React 19 + TypeScript (strict)
- Vite 5
- Tailwind CSS v4 via `@tailwindcss/vite` (no `tailwind.config.*` — theme tokens
  live in `src/index.css` under `@theme inline`; typography via
  `@plugin "@tailwindcss/typography"`)
- shadcn/ui (`new-york` style) — components live in `src/components/ui/`
- Radix UI primitives, lucide-react icons, class-variance-authority
- `react-markdown` + `remark-gfm` for rendering study notes
- localStorage for persistence (no backend)

## Commands

All commands run from the repo root:

```sh
npm install
npm run parse      # regenerate JSON datasets from the markdown + prebuilt sources
npm run dev        # start Vite on http://localhost:5173 (parse runs first; PORT env overrides)
npm run build      # tsc --noEmit && vite build (parse runs first)
npm run preview    # preview the production build
npm run test:e2e   # Playwright browser tests against the built app (run `npm run build` first)
npm run check-data # audit weak-topic keyword mapping for the prebuilt (Claude) exams
npm test           # unit tests (Node's built-in runner, tests/unit/**/*.test.mjs)
npm run report     # question-coverage report → report/question-report.{html,json}
npm run questions -- diff  # lint + list questions added/changed since origin/main that still need a review
```

`check-data` (`scripts/check-topic-mapping.mjs`) is a regression gate for the
study-guide mapping: it replays `mapQuestionToTopics` against each prebuilt
question's ground-truth `topic` field and exits non-zero if fewer than
`--min-correct`% of questions flag their true topic (or more than `--max-wrong`%
flag only a wrong one). AWS exams carry no per-question topic tag, so they're
skipped. Run it after editing keywords or adding a prebuilt exam.

`predev` and `prebuild` chain to `npm run parse`, which runs both
`parse-questions.mjs` and `parse-sections.mjs`. JSON regeneration is hands-off
in the normal flow; if the upstream sources are missing the parsers no-op and
the committed JSON is used as-is.

## Repo skills

Common workflows are captured as Claude Code skills under `.claude/skills/`.
Prefer them over improvising — they encode this repo's conventions and footguns:

- **`add-exam`** — wire a new exam/question bank into the app end to end (both
  the markdown-submodule and prebuilt-JSON paths; mirrors "Adding a new exam" below).
- **`check-data`** — audit the weak-topic keyword mapping (`npm run check-data`).
- **`sync-upstream`** — bump the AWS submodule pins and regenerate the datasets.
- **`validate-questions`** — validate the prebuilt questions a diff (PR/MR,
  branch, commit range or uncommitted work) adds or changes: lint them, have
  subagents answer them blind against Anthropic's docs, adjudicate
  disagreements, then populate each one's `confidence` rating, `source_id`, the
  bank totals and topic keywords (`scripts/review-questions.mjs`,
  `npm run questions -- <diff|prepare|compare|apply|keywords|lint>`).

## CI/CD

CI (`.github/workflows/ci.yaml`) runs on every push: `npm run format:check`,
`npm run typecheck`, `npm test`, `npm run check-data`, the build, `npm run
report`, and the Playwright tests (run the fast subset locally with `npm run
ci`; `npm run format` fixes style). The question report and screenshots are
uploaded as unzipped artifacts, and the report's digest is added to the job
summary. CD (`.github/workflows/main.yaml`) deploys to S3
(`aws s3 sync … --delete`) on every push to `main` — public and effectively
irreversible, so get an explicit user yes before pushing to `main`.

## Folder conventions

```
src/
├── main.tsx                  # entry — light theme by default
├── App.tsx                   # thin shell — view switching + provider toggle + lazy-loaded StudyScreen
├── index.css                 # Tailwind v4 + theme tokens (OKLCH); AWS default + `.theme-claude` override
├── hooks/
│   └── useProvider.ts        # AWS/Claude selection: persists + toggles `.theme-claude` + document.title
├── lib/
│   ├── utils.ts               # `cn()` helper (clsx + tailwind-merge)
│   └── provider.ts            # Provider localStorage read/write + PROVIDER_LABEL
├── components/ui/            # shadcn primitives — touch sparingly, regenerate via CLI
├── features/quiz/            # quiz feature
│   ├── types.ts              # Question, ExamData, QuizState, Provider, etc
│   ├── data/                 # generated by parse-questions.mjs — do not hand-edit
│   │   ├── <provider>/<exam>.json  # full question set, one subfolder per provider (lazy-loaded on quiz start)
│   │   └── meta.json         # eager: examId, name, short, questionCount, provider per exam
│   ├── lib/
│   │   ├── exams.ts          # examMeta (eager) + examsForProvider(provider) + loadExam(id) (async chunk)
│   │   ├── scoring.ts        # buildQuiz, isAnswerCorrect, finalize, answeredCount
│   │   ├── storage.ts        # localStorage load/save helpers
│   │   └── confidence.ts     # answer-confidence (RAG) wording + legend
│   ├── hooks/
│   │   └── useQuiz.ts        # state machine + lockAnswer (instant-mode flagging)
│   └── components/
│       ├── SetupScreen.tsx
│       ├── QuizScreen.tsx
│       ├── QuestionCard.tsx
│       ├── ConfidenceFootnote.tsx # RAG footnote + details popover
│       ├── QuestionGrid.tsx
│       ├── ResumeBanner.tsx
│       ├── ResultsScreen.tsx
│       └── RichText.tsx      # URL-safe text renderer for explanations
└── features/study/           # study notes + adaptive study-guide feature
    ├── types.ts              # Section, StudyData, TopicIndexEntry, StudyGuideEntry
    ├── data/                 # generated by parse-sections.mjs — do not hand-edit
    │   ├── <provider>/<exam>.json  # full sections, one subfolder per provider (lazy-loaded with StudyScreen)
    │   └── topic-index.json  # lightweight {id, examId, slug, category, title, keywords} across ALL exams/providers (eager)
    ├── lib/
    │   ├── sections.ts       # studyData registry + groupSections()
    │   ├── topics.ts         # mapQuestionToTopics(question, examId) using regex over keywords
    │   └── study-guide.ts    # localStorage CRUD for the user's flagged topics
    ├── hooks/
    │   └── useStudyGuide.ts  # reactive read + mutate + cross-component sync
    └── components/
        ├── StudyScreen.tsx   # provider-filtered exam picker + sidebar + content + flagged group
        ├── SectionPicker.tsx # grouped topic list with optional checkbox adornments
        └── MarkdownView.tsx  # react-markdown wrapper with prose styling
```

## Provider switch (AWS ⇄ Claude)

`useProvider()` (`src/hooks/useProvider.ts`) owns the current `Provider`
(`"aws" | "claude"`), persisted at `localStorage["examprep:v1:provider"]`
(default `"aws"`) via `src/lib/provider.ts` (`loadProvider`/`saveProvider` +
`PROVIDER_LABEL`). On change it toggles a `theme-claude` class on `<html>` —
`src/index.css` keys an entire palette off that class (plus a
`.theme-claude.dark` variant) — and updates `document.title`.

The two themes differ in **color and typeface**. AWS is the default `:root`
palette (off-white canvas, smile-orange `--primary`) with `--font-display`
aliased to the sans stack; `.theme-claude` swaps in a warm cream/terracotta
palette, sets `--font-sans` to **Inter** and `--font-display` to the
**Fraunces** serif. Both webfonts are loaded once in `index.html` via Google
Fonts. Use the `font-display` utility (e.g. the header wordmark, the
`SetupScreen` card title) for anything that should pick up the serif under the
Claude theme.

The header `Tabs` switch (`App.tsx`) only renders while `view.kind === "setup"`
— it's hidden mid-quiz and on the results screen so switching can't pull the
theme/data out from under an in-progress attempt, mirroring how Study mode
already only opens from the setup screen. `SetupScreen` and `StudyScreen` are
mounted with `key={provider}` so their local state (selected exam, length,
etc.) resets cleanly on switch rather than needing manual sync effects.

Each exam's `ExamMeta` (`src/features/quiz/lib/exams.ts`) carries a
`provider` field; `examsForProvider(provider)` is the single source of truth
for which exams appear in `SetupScreen`'s exam picker and `StudyScreen`'s exam
tabs (it skips any id missing from `meta.json`, so a not-yet-parsed exam can't
crash the picker). `useQuiz(provider)` takes the active provider and re-hydrates
the in-progress quiz for _that_ provider whenever it changes (the mount effect
is keyed on `provider`), so a saved AWS attempt never surfaces while Claude is
active, and vice versa.

### Conventions

- **Path alias.** Always import via `@/...` (e.g. `@/components/ui/button`). Both
  `vite.config.ts` and `tsconfig.json` define `@/* -> ./src/*`.
- **Feature isolation.** All quiz logic stays under `src/features/quiz/`. Add new
  features as sibling folders, not by sprawling into `App.tsx` or `lib/`.
- **State updates are pure.** `useQuiz` exposes the state-machine actions
  (`startQuiz`, `updateQuiz`, etc.); pure helpers (`setQuestionSelection`,
  `lockQuestion`, `moveCursor`) return new `QuizState` objects. Components stay
  declarative — don't mutate state inline.
- **Styling.** Use Tailwind utilities + the `cn()` helper. Don't reintroduce a
  `.css` module or hand-rolled stylesheet. Theme colors come from CSS variables
  in `index.css` — refer to them by Tailwind name (`bg-primary`,
  `text-muted-foreground`). Both providers share these token names, so styling
  by token automatically re-themes on switch; never hard-code a hex/oklch color.
  Use `font-display` for display type (it goes serif under the Claude theme).
- **shadcn components.** Add new primitives with
  `npx shadcn@latest add <name>` — that respects `components.json`. Edit in place
  if you need to customize; do not re-export from `@/components/ui` indirectly.
- **Comments.** Default to none. Only justify the _why_ — hidden constraints,
  workarounds, non-obvious invariants.
- **Persistence keys.** localStorage keys are versioned (`examprep:v1:...`).
  If you change the on-disk shape, bump the version and add a load-time migration
  rather than silently breaking saved progress. Keys that hold per-provider
  progress (in-progress quiz, history, study-screen last-viewed) carry a
  `:aws`/`:claude` suffix — see `features/quiz/lib/storage.ts` — so switching
  providers can never clobber the other side's saved state; the study guide
  (`examprep:v1:study-guide`) is the one deliberate exception, see below.

## Adaptive study guide

Incorrect questions are mapped to study topics via
`features/study/lib/topics.ts#mapQuestionToTopics(question, examId)`, which runs
a whole-word regex of each section's keywords against the question stem +
options + explanation. Matching is **case-sensitive for AWS exams** (service
names are always title-cased, so loose matching false-positives generic words
like "Backup"/"Translate") but **case-insensitive for Claude exams** (their
keywords are conceptual labels like "Context"/"Format" that appear lowercase in
quoted prompts) — the per-exam casing is keyed off `examMeta[examId].provider`.
Matches are unioned and merged into the user's persistent guide at
`localStorage["examprep:v1:study-guide"]`.

Unlike in-progress/history/last-viewed (see "Persistence keys" above), this
key is **not** namespaced per provider — it's a single object keyed by
`topicId` holding entries for every exam across both providers, each entry
tagged with its own `examId`. `entriesForExam()`/`useStudyGuide().entriesFor()`
already filter by `examId` on every read, so AWS and Claude entries never leak
into each other's UI despite sharing storage — splitting the key would add a
second migration and a second source of truth for no behavioral change.

The flagging timing depends on the feedback mode:

- **Instant mode** — `useQuiz.lockAnswer` flags topics the moment a wrong answer
  is locked, so the guide grows in real time as the user works through the quiz
  (and survives if they exit before finishing).
- **Submit-at-end mode** — `useQuiz.finishQuiz` runs the same mapping on every
  incorrect answer when the quiz is finalized. It explicitly skips the
  instant-mode path so locks aren't re-flagged on submit.

The guide surfaces in two places:

- A weak-topics banner on the **Setup screen** with a tap-to-review affordance.
- A **"Your study guide"** group at the top of the **StudyScreen** sidebar with
  a checkbox per topic. Unmastered topics get a `×N` hits badge for recurring
  weak spots; mastered topics stay visible with a strike-through and demote
  below unmastered ones. A "Clear mastered" action drops the ticked items.

Side effects in `useQuiz` (writing to localStorage, dispatching the
`examprep:study-guide-changed` event) deliberately run **outside** the
`setView` updater so React StrictMode's double-invocation in dev doesn't double
the `hits` counter.

Keyword derivation is deliberately conservative — we'd rather miss a topic
match than mis-attribute one. It applies only to the **markdown-sourced (AWS)**
exams; prebuilt (Claude) sections carry hand-authored `keywords` in their
source JSON and pass through unchanged — validate those with `npm run
check-data`. The derived signal sources are:

- "Amazon X" / "AWS X" service captures (highest precision)
- ALL-CAPS acronyms 3-5 chars from titles and slugs (filtered against a stopword
  list for very generic terms like `AI`, `ML`, `GB`)
- Section-title phrases minus parens
- H2 headings inside the section content (skipped for "introduction"/"summary"
  aggregate pages so they don't double-flag dedicated service pages)

Adjust the stopwords or `isAggregateSection()` heuristic in
`scripts/parse-sections.mjs` if you find a section is over-firing.

## Data flow

1. User picks an exam, length, mode, and shuffle in `SetupScreen`. Counts and
   exam names come from the eager `meta.json`; the heavy question JSON has
   not loaded yet.
2. `useQuiz.startQuiz(config)` is async — it dynamically imports the matching
   exam's question chunk via `loadExam(id)`, builds a fresh `QuizState`, and
   saves it to localStorage. The Start button shows a spinner while the chunk
   is in flight.
3. `QuizScreen` renders the current question. Selections call `updateQuiz`
   (pure transition); locks call `lockAnswer` which both updates state and, in
   instant mode, flags any wrong answer's topics into the study guide. Every
   state change is debounce-saved to localStorage so a refresh resumes mid-quiz.
4. On finish, `useQuiz.finishQuiz` finalizes scoring, appends to history,
   flags topics for end-mode incorrect answers, clears the in-progress slot,
   and switches the view to `ResultsScreen`.

## Adding a new exam

The `add-exam` skill automates this; the steps below are the underlying
contract. There are two source paths, depending on where the content comes from.

### From a markdown submodule (AWS-style)

1. Add the new content repo as a submodule at the repo root:
   ```sh
   git submodule add <url> <submodule-name>
   ```
   The repo should contain:
   - Practice questions (markdown matching `1. Question…`, `    - A. …`,
     `<details>...Correct answer: X</details>` — see `parseAnswerTail` for the
     answer-format variants the parser already handles).
   - Study notes (`sections/*.md` flat, or `section/<category>/*.md` nested).
2. Append a new entry to the `exams` array in `scripts/parse-questions.mjs`
   and `scripts/parse-sections.mjs` with the submodule paths and a
   `provider: "aws" | "claude"`.

### From a prebuilt JSON file (Claude-style, no submodule)

Use this when the content is a static, hand-authored dataset rather than a
markdown collection to parse — see `developer-foundations` for a working
example.

1. Drop the raw file(s) in `scripts/sources/` as a
   `<prefix>_practice_questions.json` + `<prefix>_study_guide.json` pair.
   Questions need `id`, `domain`, `question`, `options` (an object keyed by
   letter), `correct` (array of letters), `explanation`, optionally a
   `confidence` rating (see "Answer confidence (RAG)" below), and optionally a
   `topic` matching a study-guide section title (only that lets `check-data`
   grade the exam's keyword mapping); sections must already match the app's
   `Section` shape (`{id, examId, slug, category, title, keywords, content}`) —
   `parse-sections.mjs` validates every required field and throws if one is
   missing.
2. Append a new entry to the `prebuiltExams` array in
   `scripts/parse-questions.mjs` (with a normalizer like
   `buildPrebuiltQuestions` if the raw question shape differs) and
   `scripts/parse-sections.mjs`.

### Both paths

3. Add the new id to the `ExamId` union in `src/features/quiz/types.ts`, and
   add it to `PROVIDER_EXAM_IDS` in `src/features/quiz/lib/exams.ts` under the
   right provider.
4. Add a `case` for the new id in `src/features/quiz/lib/exams.ts#loadExam`
   so it dynamic-imports the new question JSON, and add the new section JSON
   to `src/features/study/lib/sections.ts#studyData`.
5. Run `npm run parse` to regenerate both datasets, `meta.json`, and
   `topic-index.json`.

## Things to avoid

- Don't hand-edit files under `src/features/quiz/data/` or
  `src/features/study/data/` — they are regenerated. Prebuilt-JSON exam
  content (no submodule) lives in `scripts/sources/` instead and _is_
  hand-edited directly — only the generated `data/` output is off-limits.
- Don't commit changes inside the submodule directories. Send fixes upstream
  to the source repos linked at the top of this file, then bump the pin via
  `git submodule update --remote`.
- Don't import the per-exam question JSON synchronously — go through
  `loadExam(id)` so Vite keeps it as its own chunk.
- Don't bypass `useQuiz` to mutate quiz state from a leaf component.
- Don't downgrade React below 19 — Radix's current minor versions require it.
- Don't put localStorage writes or other side effects inside a `setState`
  updater — StrictMode runs them twice in dev.

## Answer confidence (RAG)

Prebuilt (Claude) questions may carry a `confidence` object, recording how well
their answer key has been verified. The parser passes it through to the shipped
data, and `QuestionCard`/`ResultsScreen` render it as a footnote
(`features/quiz/components/ConfidenceFootnote.tsx`). The footnote is a
colour-plus-icon label that opens a popover explaining the rating, with a legend
for all three statuses. Doc links appear only after the question is answered,
since they could hint at it. Questions without the field, such as all AWS
questions, show no footnote.

```json
"confidence": {
  "rag": "green | amber | red",
  "level": "high | medium | low",
  "basis": "docs | reasoning",
  "timeSensitive": false,
  "reviewed": "2026-10-05",
  "reworded": true,
  "sources": ["https://platform.claude.com/docs/en/..."],
  "contentHash": "0123456789abcdef"
}
```

- **green**: a reviewer answered blind, matched the key with high confidence,
  and confirmed it in Anthropic's docs.
- **amber**: matched the key, but rests on best-practice reasoning or medium
  confidence.
- **red**: a reviewer disagreed or had low confidence.
- `reworded` (optional) marks questions edited after review.
- `timeSensitive` marks answers that depend on recently changed platform
  behaviour, which the live exam may lag.
- `contentHash` (written by `apply`) is a hash of the question, options, key
  and explanation that were reviewed. `diff` treats the rating as current only
  while it still matches.

`tests/unit/question-confidence-data.test.mjs` enforces the schema and the
rules that tie a rating to its evidence: green needs `high` + `docs` + a
source, low confidence must be red, and sources must be Anthropic-owned docs. It
also checks that every CCDV-F question is rated. When you add or edit a
prebuilt question, run the `validate-questions` skill: it reviews the questions
your diff touched and writes `confidence` for you (don't hand-edit it), or the
test will fail. `npm run questions -- diff` flags any rating older than the
latest edit to its question.

`tests/unit/question-length-tell.test.mjs` guards both banks against an
answer-length tell: the keyed option may be the longest option in at most 40%
of single-answer questions (`LONGEST_KEYED_MAX`), and no other length rank may
exceed that either. `npm run questions -- lint` fails a bank over the limit.
When writing questions, keep keys to their essential claim (detail goes in the
explanation) and give distractors comparable, plausible-but-wrong detail. The coverage report counts ratings per exam and warns on red or unrated
questions. User-facing wording lives in `features/quiz/lib/confidence.ts`, which
`tests/unit/confidence.test.mjs` imports directly through Node's type
stripping, so keep that file free of runtime imports.

## Question coverage report

`scripts/question-report.mjs` counts questions per exam and per category:
domains for prebuilt (Claude) exams, with blueprint weight and drift, or
practice sets for AWS exams. Prebuilt exams also get per-topic counts, the
complexity mix and the answer-key spread. It reads the generated
`src/features/quiz/data/` plus `scripts/sources/` (only the source banks carry
topics and weights) and writes to `report/` (gitignored):

- `question-report.json`: the canonical data, with a versioned `schemaVersion`.
- `question-report.html`: a self-contained view of the same data (inline CSS,
  no scripts or network, light/dark), with the JSON embedded in a
  `<script type="application/json" id="report-data">` block.

Warnings flag meta/data count mismatches, untagged questions, topics with no
study section or no questions, thin topics (< 3 questions), and domains more
than 5 percentage points off their blueprint weight. They are informational and
never fail CI. Pure functions are exported and covered by
`tests/unit/question-report.test.mjs`. If you change the JSON shape, bump
`SCHEMA_VERSION`.

## Browser tests

`tests/e2e/app.spec.ts` (Playwright, Chromium) drives the production build served
by `vite preview` on port 4173: setup-screen screenshots at five viewports, the
AWS ⇄ Claude toggle, a quiz start, and study notes. Each screenshot lands in
`test-results/` and CI uploads every PNG as its own unzipped artifact. Build with
the submodules initialised first, otherwise the parsers overwrite the committed
AWS data.
