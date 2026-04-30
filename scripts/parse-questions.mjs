#!/usr/bin/env node
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(__dirname, "..", "src", "features", "quiz", "data");

const exams = [
  {
    id: "cloud-practitioner",
    name: "AWS Certified Cloud Practitioner",
    short: "CLF-C02",
    dir: path.join(repoRoot, "AWS-Certified-Cloud-Practitioner-Notes", "practice-exam"),
    filePattern: /^practice-exam-(\d+)\.md$/,
  },
  {
    id: "ai-practitioner",
    name: "AWS Certified AI Practitioner",
    short: "AIF-C01",
    dir: path.join(repoRoot, "aws-certified-ai-practitioner-study-notes", "practice-test"),
    filePattern: /^practice-test-(\d+)\.md$/,
  },
];

// Strip markdown emphasis/links so plain text reads cleanly in the UI.
function cleanText(s) {
  return s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    // Markdown link [label](url) -> "label"
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Markdown autolink <https://…> -> "https://…"
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFile(content, sourceFile) {
  const questions = [];
  // Split into question blocks: each starts at the beginning of a line with `N. `
  // and runs until the next `M. ` line at column 0 (or EOF).
  const lines = content.split(/\r?\n/);

  // Find indices where a new question begins (numbered list at column 0).
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\d+\.\s+\S/.test(lines[i])) {
      starts.push(i);
    }
  }

  for (let s = 0; s < starts.length; s++) {
    const startIdx = starts[s];
    const endIdx = s + 1 < starts.length ? starts[s + 1] : lines.length;
    const block = lines.slice(startIdx, endIdx);
    const parsed = parseBlock(block, sourceFile);
    if (parsed) questions.push(parsed);
  }

  return questions;
}

// The source markdown uses several styles for multi-letter answers:
//   "B"          single
//   "B, C"       comma-separated, with or without space
//   "BC"         concatenated
//   "B and D"    word-separated
//   "Ac"         case-typo'd concatenation
// And occasionally a free-text answer ("Chain-of-thought reasoning") for
// questions whose options aren't lettered. This routine returns the unique
// uppercase letter list, plus any trailing text that should be folded into
// the explanation (e.g. "Correct answer: B. Reason follows.").
function parseAnswerTail(rawTail, options) {
  // Drop any parenthetical aside, then truncate at the first sentence break
  // so we don't sweep up explanation text into the answer.
  let t = rawTail.replace(/\([^)]*\)/g, "").trim();
  let trailing = "";
  const periodIdx = t.search(/\.(\s|$)/);
  if (periodIdx > 0) {
    trailing = t.slice(periodIdx + 1).trim();
    t = t.slice(0, periodIdx).trim();
  }

  // Strip separator tokens to see if what's left is just answer letters.
  const cleaned = t.replace(/\band\b/gi, "").replace(/[\s,&\-]+/g, "");
  if (cleaned.length >= 1 && cleaned.length <= 5 && /^[A-Ea-e]+$/.test(cleaned)) {
    const letters = [];
    const seen = new Set();
    for (const c of cleaned) {
      const u = c.toUpperCase();
      if (!seen.has(u)) {
        seen.add(u);
        letters.push(u);
      }
    }
    return { letters, trailing };
  }

  // Not a letter answer — try to map the text back to one of the options.
  // Sources occasionally inline the answer text directly (e.g. for ordering
  // or open-ended questions).
  if (t.length > 0 && options.length > 0) {
    const lower = t.toLowerCase();
    for (const opt of options) {
      const ot = opt.text.toLowerCase().replace(/\.$/, "").trim();
      if (lower === ot || lower.includes(ot) || ot.includes(lower)) {
        return { letters: [opt.key], trailing };
      }
    }
  }

  return { letters: [], trailing };
}

function parseBlock(blockLines, sourceFile) {
  const firstLine = blockLines[0];
  const numMatch = firstLine.match(/^(\d+)\.\s+(.*)$/);
  if (!numMatch) return null;
  const number = parseInt(numMatch[1], 10);

  // Walk lines until we hit the first option (line starting with `    - A.` etc.).
  // Everything before that is the question stem (may be multi-line).
  const stemLines = [numMatch[2]];
  let i = 1;
  for (; i < blockLines.length; i++) {
    const line = blockLines[i];
    if (/^\s{2,}-\s+[A-Z]\.\s/.test(line)) break;
    if (/^\s*<details/.test(line)) break;
    stemLines.push(line.trim());
  }

  // Collect options. Options can wrap to a continuation line with deeper indent.
  const options = [];
  for (; i < blockLines.length; i++) {
    const line = blockLines[i];
    const optMatch = line.match(/^\s{2,}-\s+([A-Z])\.\s+(.*)$/);
    if (optMatch) {
      options.push({ key: optMatch[1], text: optMatch[2].trim() });
      continue;
    }
    if (/^\s*<details/.test(line)) break;
    if (line.trim() === "") continue;
    // Continuation of the previous option (deeper indent, no bullet).
    if (options.length > 0 && /^\s+\S/.test(line)) {
      options[options.length - 1].text += " " + line.trim();
    }
  }

  // Locate the answer + explanation inside the <details> block.
  let answer = null;
  let explanation = "";
  let inDetails = false;
  let inExplanation = false;
  for (; i < blockLines.length; i++) {
    const line = blockLines[i];
    if (/<details/.test(line)) {
      inDetails = true;
      continue;
    }
    if (/<\/details>/.test(line)) {
      inDetails = false;
      break;
    }
    if (!inDetails) continue;
    const ansHeader = line.match(/Correct\s+answers?:\s*(.*)$/i);
    if (ansHeader) {
      const result = parseAnswerTail(ansHeader[1], options);
      answer = result.letters;
      // Whatever was left of the answer tail is treated as inline explanation
      // — happens with sources that put "Correct answer: B. Reason follows."
      inExplanation = true;
      if (result.trailing) explanation += result.trailing + " ";
      continue;
    }
    if (inExplanation) {
      const cleaned = line.replace(/^\s+/, "").replace(/^Explanation:\s*/i, "").trim();
      if (cleaned) explanation += cleaned + " ";
    }
  }

  if (!answer || answer.length === 0 || options.length === 0) return null;

  const stem = cleanText(stemLines.join(" "));
  const cleanedOptions = options.map((o) => ({ key: o.key, text: cleanText(o.text) }));

  // Detect "choose two/three/etc." even if multiple letters weren't specified
  // — but we trust the explicit answer letters as ground truth.
  const multi = answer.length > 1 || /\(choose\s+(two|three|four|five|2|3|4|5)/i.test(stem);

  return {
    id: `${path.basename(sourceFile, ".md")}-q${number}`,
    sourceFile: path.basename(sourceFile),
    number,
    stem,
    options: cleanedOptions,
    correct: answer,
    multi,
    explanation: cleanText(explanation),
  };
}

async function build() {
  if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });

  const summary = [];
  // meta is eager-imported by the app so the setup screen can show counts
  // without pulling the heavy questions arrays.
  const meta = {};
  for (const exam of exams) {
    if (!existsSync(exam.dir)) {
      console.warn(`Skipping ${exam.id}: source dir not found at ${exam.dir}`);
      continue;
    }
    const entries = await readdir(exam.dir);
    const files = entries
      .filter((f) => exam.filePattern.test(f))
      .sort((a, b) => {
        const an = parseInt(a.match(exam.filePattern)[1], 10);
        const bn = parseInt(b.match(exam.filePattern)[1], 10);
        return an - bn;
      });

    const allQuestions = [];
    for (const f of files) {
      const full = path.join(exam.dir, f);
      const text = await readFile(full, "utf8");
      const qs = parseFile(text, full);
      for (const q of qs) {
        allQuestions.push({
          ...q,
          examSet: f.replace(/\.md$/, ""),
        });
      }
    }

    // Re-key with a globally unique id per exam to keep things tidy.
    const rekeyed = allQuestions.map((q, idx) => ({
      ...q,
      id: `${exam.id}-${idx + 1}`,
    }));

    const out = {
      examId: exam.id,
      examName: exam.name,
      examShort: exam.short,
      generatedAt: new Date().toISOString(),
      questionCount: rekeyed.length,
      questions: rekeyed,
    };

    const outPath = path.join(outDir, `${exam.id}.json`);
    await writeFile(outPath, JSON.stringify(out, null, 2));
    meta[exam.id] = {
      examId: exam.id,
      examName: exam.name,
      examShort: exam.short,
      questionCount: rekeyed.length,
    };
    summary.push({ exam: exam.id, files: files.length, questions: rekeyed.length });
  }

  await writeFile(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));

  console.log("Parsed exam questions:");
  for (const s of summary) {
    console.log(`  ${s.exam}: ${s.questions} questions across ${s.files} files`);
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
