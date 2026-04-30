import type { ExamId } from "../../quiz/types";
import type { StudyGuide, StudyGuideEntry } from "../types";

const STORAGE_KEY = "examprep:v1:study-guide";

function safeGet(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeSet(value: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* ignore */
  }
}

export function loadStudyGuide(): StudyGuide {
  const raw = safeGet();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as StudyGuide;
  } catch {
    return {};
  }
}

export function saveStudyGuide(guide: StudyGuide) {
  safeSet(JSON.stringify(guide));
}

// Adds (or refreshes) topic entries for the supplied exam. Existing entries
// are kept — including mastered=true ones — so the user's "this is sorted"
// decisions persist; we only bump `lastSeenAt`/`hits` on re-encounter so the
// UI can surface recurring weaknesses.
export function addTopics(
  guide: StudyGuide,
  topicIds: string[],
  examId: ExamId
): StudyGuide {
  const now = Date.now();
  const next: StudyGuide = { ...guide };
  for (const topicId of topicIds) {
    const existing = next[topicId];
    if (existing) {
      next[topicId] = {
        ...existing,
        lastSeenAt: now,
        hits: existing.hits + 1,
      };
    } else {
      next[topicId] = {
        topicId,
        examId,
        addedAt: now,
        lastSeenAt: now,
        hits: 1,
        mastered: false,
      };
    }
  }
  return next;
}

export function setMastered(
  guide: StudyGuide,
  topicId: string,
  mastered: boolean
): StudyGuide {
  const existing = guide[topicId];
  if (!existing) return guide;
  return { ...guide, [topicId]: { ...existing, mastered } };
}

export function removeTopic(guide: StudyGuide, topicId: string): StudyGuide {
  if (!guide[topicId]) return guide;
  const next = { ...guide };
  delete next[topicId];
  return next;
}

export function clearMastered(guide: StudyGuide): StudyGuide {
  const next: StudyGuide = {};
  for (const [id, entry] of Object.entries(guide)) {
    if (!entry.mastered) next[id] = entry;
  }
  return next;
}

export function entriesForExam(guide: StudyGuide, examId: ExamId): StudyGuideEntry[] {
  return Object.values(guide).filter((e) => e.examId === examId);
}
