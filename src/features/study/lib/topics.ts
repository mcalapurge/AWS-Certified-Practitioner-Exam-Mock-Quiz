import type { ExamId, Question } from "../../quiz/types";
import type { TopicIndexEntry } from "../types";
import topicIndexJson from "../data/topic-index.json";

export const topicIndex: TopicIndexEntry[] = topicIndexJson as TopicIndexEntry[];

export const topicsById = new Map<string, TopicIndexEntry>(
  topicIndex.map((t) => [t.id, t])
);

// Compile each topic's keywords into a single case-sensitive whole-word regex
// up front so question-mapping is O(topics) per question. Case-sensitive on
// purpose — AWS service names are always title-cased in question text, and
// matching loosely makes generic words ("Backup", "Translate") false-positive
// against incidental sentence usage.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPattern(keywords: string[]): RegExp | null {
  if (!keywords.length) return null;
  const alternation = keywords
    .map(escapeRegex)
    .sort((a, b) => b.length - a.length) // longer first to prefer specific match
    .join("|");
  return new RegExp(`(?:^|[^A-Za-z0-9])(?:${alternation})(?:[^A-Za-z0-9]|$)`);
}

const compiled: Array<{ topic: TopicIndexEntry; pattern: RegExp }> = [];
for (const t of topicIndex) {
  const p = buildPattern(t.keywords);
  if (p) compiled.push({ topic: t, pattern: p });
}

export function mapQuestionToTopics(question: Question, examId: ExamId): string[] {
  const haystack =
    question.stem + "\n" + question.options.map((o) => o.text).join("\n");
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
