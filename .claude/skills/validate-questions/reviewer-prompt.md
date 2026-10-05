# Blind reviewer prompt

Fill in `{EXAM}`, `{TODAY}`, `{INPUT}` and `{OUTPUT}`, then pass the text below
the line to one subagent per batch. `{EXAM}` is the bank's `exam` field;
`{INPUT}` is the absolute path of a file under `<out>/blind/`; `{OUTPUT}` is the
same file name under `<out>/answers/`.

---

You are reviewing practice questions for the "{EXAM}" exam. Today is {TODAY}.
Answer each question BLIND (you are not given the answer key) and verify the
facts with research, so we can catch wrong answer keys and ambiguous questions.

INPUT: {INPUT}
Each item has: bank, id, select (how many options are correct), question, and
options (A–D).

STRICT RULES

- Read ONLY your input file. Do NOT open, list or search any other file in the
  repository or the review folder: they contain the answer key and would
  invalidate the review.
- Don't rely on memory for facts about the Claude API, SDKs, Claude Code, MCP,
  models, pricing, limits or behaviour unless you are certain. Verify them:
  - WebFetch works for Anthropic's docs: https://platform.claude.com/docs/en/...
    (Claude API) and https://code.claude.com/docs/en/... (Claude Code and the
    Agent SDK). Find pages from the indexes at
    https://platform.claude.com/docs/llms.txt and
    https://code.claude.com/docs/llms.txt. anthropic.com pages may also work.
  - WebSearch works for general searches. Many third-party sites are blocked
    by the network proxy; if a fetch is blocked, move on to another source.
  - Fetch each docs page once and reuse it across the batch.
- For pure judgement questions (software engineering, agent design, security
  principles), reason from Anthropic's published guidance and mainstream
  engineering practice, and search whenever a specific claim is involved.
- Pick the BEST answer as an exam would intend it. Separately, note any other
  option that is also defensible.
- Mark `time_sensitive` true when the right answer depends on platform
  behaviour that changed in roughly the last 12 months, so the live exam may
  still expect the older behaviour.

OUTPUT: write a JSON array to {OUTPUT}, one object per question, in input
order:

```json
{
  "bank": "<copy from input>",
  "id": 0,
  "answer": ["B"],
  "confidence": "high | medium | low",
  "basis": "verified | reasoning",
  "sources": ["<Anthropic docs URLs you actually consulted for this question>"],
  "also_defensible": ["<letters, or empty>"],
  "time_sensitive": false,
  "issues": "<empty, or a concise note: ambiguous wording, a premise that is outdated or wrong per the docs, an option that is factually wrong in a way that matters, or a claim you couldn't verify>"
}
```

- `answer` must contain exactly `select` letters.
- `basis` is `verified` only when a doc page confirmed the answer, and then
  `sources` must list it.
- Leave `issues` empty when the question is fine. Don't use it to explain
  your choice or to confirm the key: any text there sends the question to a
  second reviewer.
- Validate the file before finishing:
  `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1]))' {OUTPUT}`

Finish with a short summary: the number of questions, how many were low or
medium confidence, and the ids with issues.
