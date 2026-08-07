import type { ExamId, Question } from "../../quiz/types";
import { examMeta } from "../../quiz/lib/exams";
import type { TopicIndexEntry } from "../types";
import topicIndexJson from "../data/topic-index.json";

export const topicIndex: TopicIndexEntry[] = topicIndexJson as TopicIndexEntry[];

export const topicsById = new Map<string, TopicIndexEntry>(
  topicIndex.map((t) => [t.id, t])
);

// AWS keywords are always title-cased service names in question text, so
// case-sensitive matching avoids generic words ("Backup", "Translate") false-
// positiving against incidental sentence usage. Claude exam keywords are
// conceptual labels ("Context", "Format") that show up lowercase inside quoted
// prompts and explanations, so those exams need case-insensitive matching to
// hit at all.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPattern(keywords: string[], caseInsensitive: boolean): RegExp | null {
  if (!keywords.length) return null;
  const alternation = keywords
    .map(escapeRegex)
    .sort((a, b) => b.length - a.length) // longer first to prefer specific match
    .join("|");
  return new RegExp(
    `(?:^|[^A-Za-z0-9])(?:${alternation})(?:[^A-Za-z0-9]|$)`,
    caseInsensitive ? "i" : undefined
  );
}

const compiled: Array<{ topic: TopicIndexEntry; pattern: RegExp }> = [];
for (const t of topicIndex) {
  const caseInsensitive = examMeta[t.examId]?.provider === "claude";
  const p = buildPattern(t.keywords, caseInsensitive);
  if (p) compiled.push({ topic: t, pattern: p });
}

export function mapQuestionToTopics(question: Question, examId: ExamId): string[] {
  const haystack = [question.stem, ...question.options.map((o) => o.text), question.explanation].join(
    "\n"
  );
  const matches: string[] = [];
  for (const { topic, pattern } of compiled) {
    // Restrict to the same exam — the user is studying for one cert at a time
    // and cross-exam matches mostly add noise (Cloud Practitioner ML section
    // and AI Practitioner Rekognition page would both fire on a Rekognition
    // question, but the user only cares about the exam they're sitting).
    if (topic.examId !== examId) continue;
    if (pattern.test(haystack)) matches.push(topic.id);
  }
  return matches;
}
