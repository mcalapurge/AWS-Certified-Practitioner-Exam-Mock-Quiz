import type { ExamId } from "../../quiz/types";
import type { Section, StudyData } from "../types";
import cloud from "../data/cloud-practitioner.json";
import ai from "../data/ai-practitioner.json";

export const studyData: Record<ExamId, StudyData> = {
  "cloud-practitioner": cloud as StudyData,
  "ai-practitioner": ai as StudyData,
};

// Humanize the directory slug used as a category in the AI exam tree.
export function humanizeCategory(category: string): string {
  return category
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bAi\b/g, "AI")
    .replace(/\bMl\b/g, "ML")
    .replace(/\bAws\b/g, "AWS");
}

export interface SectionGroup {
  category: string | null;
  label: string;
  sections: Section[];
}

// Group sections by category for sidebar rendering. Cloud-practitioner sections
// have no category, so they all fall under a single null group.
export function groupSections(data: StudyData): SectionGroup[] {
  const buckets = new Map<string, Section[]>();
  for (const s of data.sections) {
    const key = s.category ?? "__uncategorized__";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(s);
  }

  const groups: SectionGroup[] = [];
  for (const [key, sections] of buckets.entries()) {
    groups.push({
      category: key === "__uncategorized__" ? null : key,
      label: key === "__uncategorized__" ? "All topics" : humanizeCategory(key),
      sections,
    });
  }
  return groups;
}
