---
name: add-exam
description: >-
  Wire a new exam / certification / practice-question set into this quiz app end
  to end. Use this whenever the user wants to add, register, or support another
  exam, certification, question bank, or study-note collection — phrasings like
  "add the Solutions Architect exam", "wire in a new question bank", "support
  the Security Specialty cert", "add another practice test", or "hook up a new
  set of study notes". Adding an exam touches ~6 files in a precise order across
  the parsers and the app; miss one and the build fails or the exam silently
  never appears, so follow this skill rather than editing by hand.
---

# Add a new exam

Adding an exam means teaching **two parsers** to emit its data and teaching the
**app** to list and lazy-load it. The touch points are small but spread across
six places, and several are easy to forget because the failure is silent (the
exam just never shows up) rather than a hard error. Work through the steps in
order and finish with the verify step — that's what catches a missed touch point.

Read [AGENTS.md](../../../AGENTS.md) ("Adding a new exam") for the authoritative
prose version; this skill is the executable checklist.

## Step 0 — Decide the source path and provider

Two things determine the shape of the work:

- **Provider** — `"aws"` or `"claude"`. Every exam belongs to one. If the exam
  needs a _brand-new_ provider (its own theme, toggle label, etc.), stop: that's
  a bigger change (theme block in `src/index.css`, `Provider` type,
  `useProvider`, `provider.ts`) and out of scope here. Confirm with the user
  before proceeding — this skill assumes an existing provider.
- **Source path** — where the raw content comes from:
  - **Markdown submodule (AWS-style)** — a folder of markdown practice questions
    - study notes, pulled in as a read-only git submodule. Use for community
      markdown collections.
  - **Prebuilt JSON (Claude-style)** — a static, hand-authored JSON pair under
    `scripts/sources/`. Use when the content is already structured data, not
    markdown to parse. `developer-foundations` is the working example.

Ask the user which applies if it isn't obvious from their request.

Pick a **kebab-case exam id** (e.g. `solutions-architect`) and its display
`name` + `short` code (e.g. "AWS Certified Solutions Architect", "SAA-C03").
The id is used as a TypeScript union member, a filename, and a data key — keep
it stable once chosen.

## Step 1 — Register the source in BOTH parsers

The two parsers are independent and each needs its own entry.

### Path A — markdown submodule

1. Add the submodule at the repo root:

   ```bash
   git submodule add <url> <submodule-name>
   ```

   Confirm it contains practice questions (numbered markdown lists with
   `<details>…Correct answer: X</details>` — see `parseAnswerTail` in
   `scripts/parse-questions.mjs` for the answer formats already handled) and
   study notes (`sections/*.md` flat, or `section/<category>/*.md` nested).

2. Append an entry to the `exams` array in **both**
   [scripts/parse-questions.mjs](../../../scripts/parse-questions.mjs) and
   [scripts/parse-sections.mjs](../../../scripts/parse-sections.mjs):

   ```js
   // parse-questions.mjs — exams[]
   {
     id: "<exam-id>",
     name: "<Display Name>",
     short: "<CODE>",
     provider: "aws",
     dir: path.join(repoRoot, "<submodule-name>", "practice-exam"),
     filePattern: /^practice-exam-(\d+)\.md$/,
   }

   // parse-sections.mjs — exams[]
   {
     id: "<exam-id>",
     name: "<Display Name>",
     short: "<CODE>",
     provider: "aws",
     dir: path.join(repoRoot, "<submodule-name>", "sections"),
     nested: false, // true if notes are section/<category>/*.md
   }
   ```

   Match `filePattern` and `nested` to how the upstream repo actually lays out
   its files — check the submodule before assuming.

### Path B — prebuilt JSON

1. Drop the source file(s) in `scripts/sources/`. Questions need
   `id`, `domain`, `question`, `options` (object keyed by letter), `correct`
   (array of letters), `explanation`. Sections must already match the app's
   `Section` shape: `{id, examId, slug, category, title, keywords, content}`.

2. Append an entry to the `prebuiltExams` array in **both** parsers:

   ```js
   // parse-questions.mjs — prebuiltExams[]
   {
     id: "<exam-id>",
     name: "<Display Name>",
     short: "<CODE>",
     provider: "claude",
     source: path.join(repoRoot, "scripts", "sources", "<questions>.json"),
   }

   // parse-sections.mjs — prebuiltExams[]
   {
     id: "<exam-id>",
     name: "<Display Name>",
     short: "<CODE>",
     provider: "claude",
     source: path.join(repoRoot, "scripts", "sources", "<study-guide>.json"),
   }
   ```

   If the raw question shape differs from `buildPrebuiltQuestions`' expectations
   in `parse-questions.mjs`, add a normalizer modeled on it.

## Step 2 — Wire the exam into the app (3 edits)

These are the same for both source paths. TypeScript is your safety net here:
two of the three edits will fail `tsc` if you skip them, because `ExamId` drives
exhaustive `Record<ExamId, …>` types and the `loadExam` switch.

1. **`ExamId` union** — add the id in
   [src/features/quiz/types.ts](../../../src/features/quiz/types.ts):

   ```ts
   export type ExamId =
     "cloud-practitioner" | "ai-practitioner" | "developer-foundations" | "<exam-id>";
   ```

2. **Quiz registry** — in
   [src/features/quiz/lib/exams.ts](../../../src/features/quiz/lib/exams.ts):
   - add the id to `PROVIDER_EXAM_IDS` under the right provider (order here is
     the display order in the setup screen);
   - add a `case` to `loadExam` that dynamic-imports the generated JSON:
     ```ts
     case "<exam-id>": {
       const m = await import("../data/<provider>/<exam-id>.json");
       return m.default as unknown as ExamData;
     }
     ```
     Keep it a dynamic `import()` — Vite splits each exam into its own chunk so
     users only download the set they start. Never import it synchronously.

3. **Study registry** — in
   [src/features/study/lib/sections.ts](../../../src/features/study/lib/sections.ts)
   add an import and a `studyData` entry:
   ```ts
   import newExam from "../data/<provider>/<exam-id>.json";
   // …
   "<exam-id>": newExam as StudyData,
   ```

## Step 3 — Generate the data

```bash
npm run parse
```

This regenerates, for the new exam:

- `src/features/quiz/data/<provider>/<exam-id>.json`
- `src/features/study/data/<provider>/<exam-id>.json`
- and the eager indexes `src/features/quiz/data/meta.json` +
  `src/features/study/data/topic-index.json`.

Never hand-edit files under either `data/` folder — they're regenerated every
`predev`/`prebuild`. (For prebuilt exams you edit `scripts/sources/` instead.)

## Step 4 — Verify (do not skip)

1. Read the parse output — it prints per-exam question and section counts.
   Confirm the new exam appears with a non-zero, plausible count. A count far
   below the source file total means the parser silently dropped malformed
   blocks (see `parseBlock` returning `null`); investigate before moving on.
2. Confirm the new exam's key exists in
   `src/features/quiz/data/meta.json`.
3. Typecheck + build — this catches a forgotten `loadExam` case, a missing
   `studyData` entry, or a union mismatch:
   ```bash
   npm run build
   ```
4. Smoke-test in the browser (`npm run dev`): switch to the exam's provider, and
   confirm the new exam appears in the setup picker and the study screen, starts,
   and loads its questions.

## Gotchas

- **The exam registers but never appears** → it's almost always a missing
  `PROVIDER_EXAM_IDS` entry (that list, not `meta.json`, controls visibility).
- **`tsc` errors after adding the id** → you added it to `ExamId` but not to
  `loadExam` and/or `studyData`. That's the safety net working; add the missing
  entry.
- **Submodule content is read-only.** Don't commit edits inside a submodule
  directory — send fixes upstream and bump the pin (see the `sync-upstream`
  skill).
- **Do not hand-edit generated `data/` JSON** — the change will vanish on the
  next parse.
