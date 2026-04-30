import type { ExamId } from "../quiz/types";

export interface Section {
  id: string;
  examId: ExamId;
  slug: string;
  category: string | null;
  title: string;
  keywords: string[];
  content: string;
}

export interface StudyData {
  examId: ExamId;
  examName: string;
  examShort: string;
  generatedAt: string;
  sectionCount: number;
  sections: Section[];
}

// Lightweight cross-exam topic record — eager-imported so we can map incorrect
// questions to topics without pulling the heavy section-content chunks.
export interface TopicIndexEntry {
  id: string;
  examId: ExamId;
  slug: string;
  category: string | null;
  title: string;
  keywords: string[];
}

export interface StudyGuideEntry {
  topicId: string;
  examId: ExamId;
  addedAt: number;
  lastSeenAt: number;
  // How many incorrect questions have flagged this topic — useful as a
  // "weakness" indicator if we ever want to sort by severity.
  hits: number;
  mastered: boolean;
}

export type StudyGuide = Record<string, StudyGuideEntry>;
