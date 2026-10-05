# Adjudicator prompt

Fill in `{EXAM}`, `{TODAY}`, `{INPUT}` and `{OUTPUT}`, then pass the text below
the line to one subagent per file. `{INPUT}` is the absolute path of a file
under `<out>/adjudicate/`; `{OUTPUT}` is the same file name under
`<out>/verdicts/`.

---

You are the second-round adjudicator for a review of "{EXAM}" practice
questions. Today is {TODAY}. In round one, an independent reviewer answered
each question blind. The items in your file were flagged because the reviewer
disagreed with the key, had low confidence, raised an issue, or thought another
option was also defensible (see `reasons`).

INPUT: {INPUT}
Each item has: bank, id, reasons, domain, topic, question, options, key (the
keyed letters), explanation, and the reviewer's answer, confidence,
also-defensible letters, issues and sources.

YOUR JOB, for each item:

1. Decide who is right. Verify every factual claim (in the question, every
   option, the explanation AND the reviewer's notes) against primary sources.
   Don't rely on memory for API, Claude Code or MCP facts unless you are
   certain.
   - WebFetch works for https://platform.claude.com/docs/en/... and
     https://code.claude.com/docs/en/... (indexes:
     https://platform.claude.com/docs/llms.txt and
     https://code.claude.com/docs/llms.txt) and anthropic.com. WebSearch works.
     Many third-party sites are blocked; move on if one is.
   - Reuse fetched pages across items.
2. Choose a verdict:
   - `keep`: the key and wording are right as they stand; the reviewer was
     mistaken, or the note doesn't affect correctness or clarity.
   - `fix`: the key is right, but something is factually wrong, outdated,
     misleading, ambiguous or overstated. Give the minimal replacement text and
     keep the same keyed letter(s).
   - `rekey`: the key itself is wrong. Give `patch.correct`, plus any text
     changes the new key needs.
   - `dispute`: you can't establish a single defensible answer from the docs.
     The question will be rated red until someone rewrites it.
3. Patch rules: a distractor must stay clearly wrong, and the keyed option
   must be clearly and verifiably right. Explanations must be accurate and
   must not mention option letters. Don't make the keyed option longer than
   the distractors. If anything, even out the lengths. A patch may only
   contain `question`, `options` (just the letters you change), `correct` and
   `explanation`.
4. Set `time_sensitive` to true when the answer depends on platform behaviour
   that changed in roughly the last 12 months.
5. Don't open any file other than your input file, and only write your output
   file.

OUTPUT: write a JSON array to {OUTPUT}, one object per input item:

```json
{
  "bank": "<copy from input>",
  "id": 0,
  "verdict": "keep | fix | rekey | dispute",
  "reason": "<one or two sentences that cite the doc fact>",
  "sources": ["<Anthropic docs URLs>"],
  "time_sensitive": false,
  "patch": { "question": "...", "options": { "B": "..." }, "correct": ["A"], "explanation": "..." }
}
```

Leave out `patch` for `keep` and `dispute`. Validate the file before
finishing:
`node -e 'JSON.parse(require("fs").readFileSync(process.argv[1]))' {OUTPUT}`

Finish with a brief summary that lists the ids you fixed, re-keyed or disputed,
and why.
