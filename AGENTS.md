# AGENTS.md

Guidance for AI coding agents (Claude Code, Cursor, Codex, etc.) working in this repo.

## What this repo is

A quiz + study app that doubles as two differently-branded exam-prep tools
switched via an **AWS ⇄ Claude toggle** (`useProvider`, header `Tabs`): AWS
certification content sourced from two community-maintained markdown
collections by [@kananinirav](https://github.com/kananinirav), and a
Claude-certification exam (CCDV-F) sourced from a pair of prebuilt JSON files.
Switching providers changes the visual theme (`.theme-claude` in
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

The Claude content has no submodule — it's a static, hand-curated pair of
JSON files at `scripts/sources/ccdvf-practice-questions.json` and
`scripts/sources/ccdvf-study-guide.json` (500 practice questions + 53 study
sections for the "Claude Certified Developer – Foundations" exam).

Two parsers under `scripts/` build the datasets the app consumes, each
handling both the markdown-sourced (submodule) exams and the prebuilt-JSON
(Claude) exam:

- `parse-questions.mjs` → `src/features/quiz/data/<exam>.json` + `meta.json`
- `parse-sections.mjs` → `src/features/study/data/<exam>.json` + `topic-index.json`

Both run automatically before `dev` and `build`. **The submodule directories
are read-only upstream content** — do not commit changes inside them. If a
question or note needs fixing, the change should be sent upstream to the source
repos above and pulled in via `git submodule update --remote`.

## Top-level layout

```
.
├── .gitmodules                                     # submodule pins
├── AGENTS.md                                       # this file
├── CLAUDE.md                                       # pointer to AGENTS.md
├── README.md
├── AWS-Certified-Cloud-Practitioner-Notes/         # submodule — read-only upstream
├── aws-certified-ai-practitioner-study-notes/      # submodule — read-only upstream
├── scripts/                                        # markdown/JSON → app-data parsers
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
npm run parse      # regenerate JSON datasets from the markdown sources
npm run dev        # start Vite on http://localhost:5173 (parse runs first)
npm run build      # tsc --noEmit && vite build (parse runs first)
npm run preview    # preview the production build
```

`predev` and `prebuild` chain to `npm run parse`, which runs both
`parse-questions.mjs` and `parse-sections.mjs`. JSON regeneration is hands-off
in the normal flow; if the upstream sources are missing the parsers no-op and
the committed JSON is used as-is.

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
│   │   └── storage.ts        # localStorage load/save helpers
│   ├── hooks/
│   │   └── useQuiz.ts        # state machine + lockAnswer (instant-mode flagging)
│   └── components/
│       ├── SetupScreen.tsx
│       ├── QuizScreen.tsx
│       ├── QuestionCard.tsx
│       ├── QuestionGrid.tsx
│       ├── ResumeBanner.tsx
│       ├── ResultsScreen.tsx
│       └── RichText.tsx      # URL-safe text renderer for explanations
└── features/study/           # study notes + adaptive study-guide feature
    ├── types.ts              # Section, StudyData, TopicIndexEntry, StudyGuideEntry
    ├── data/                 # generated by parse-sections.mjs — do not hand-edit
    │   ├── <provider>/<exam>.json  # full sections, one subfolder per provider (lazy-loaded with StudyScreen)
    │   └── topic-index.json  # lightweight {id, examId, title, keywords} across ALL exams/providers (eager)
    ├── lib/
    │   ├── sections.ts       # studyData registry + groupSections()
    │   ├── topics.ts         # mapQuestionToTopics(question) using regex over keywords
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
(default `"aws"`). On change it toggles a `theme-claude` class on
`<html>` — `src/index.css` keys an entire warm/terracotta/serif palette off
that class (plus a `.theme-claude.dark` variant) — and updates `document.title`.

The header `Tabs` switch (`App.tsx`) only renders while `view.kind === "setup"`
— it's hidden mid-quiz and on the results screen so switching can't pull the
theme/data out from under an in-progress attempt, mirroring how Study mode
already only opens from the setup screen. `SetupScreen` and `StudyScreen` are
mounted with `key={provider}` so their local state (selected exam, length,
etc.) resets cleanly on switch rather than needing manual sync effects.

Each exam's `ExamMeta` (`src/features/quiz/lib/exams.ts`) carries a
`provider` field; `examsForProvider(provider)` is the single source of truth
for which exams appear in `SetupScreen`'s exam picker and `StudyScreen`'s exam
tabs. A saved in-progress quiz is only offered for resume
(`App.tsx#inProgressForProvider`) if its exam belongs to the currently active
provider.

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
  in `index.css` — refer to them by Tailwind name (`bg-primary`, `text-muted-foreground`).
- **shadcn components.** Add new primitives with
  `npx shadcn@latest add <name>` — that respects `components.json`. Edit in place
  if you need to customize; do not re-export from `@/components/ui` indirectly.
- **Comments.** Default to none. Only justify the *why* — hidden constraints,
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
`features/study/lib/topics.ts#mapQuestionToTopics`, which runs a case-sensitive
whole-word regex of each section's auto-derived keywords against the question
stem + options. Matches are unioned and merged into the user's persistent guide
at `localStorage["examprep:v1:study-guide"]`.

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
match than mis-attribute one. The signal sources are:
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

There are two source paths, depending on where the content comes from.

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

1. Drop the raw file(s) in `scripts/sources/`. Questions need `id`, `domain`,
   `question`, `options` (an object keyed by letter), `correct` (array of
   letters), `explanation`; sections must already match the app's `Section`
   shape (`{id, examId, slug, category, title, keywords, content}`).
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
  content (no submodule) lives in `scripts/sources/` instead and *is*
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
