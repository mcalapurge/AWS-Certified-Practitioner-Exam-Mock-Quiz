export type ExamId =
  "cloud-practitioner" | "ai-practitioner" | "developer-foundations" | "associate-foundations";

export type Provider = "aws" | "claude";

export type FeedbackMode = "instant" | "end";

export interface QuestionOption {
  key: string;
  text: string;
}

/** Red/amber/green rating of how well a question's answer key has been verified. */
export type ConfidenceRag = "green" | "amber" | "red";

/**
 * Result of the independent answer-key review for a question. Only prebuilt
 * (Claude) exams carry it; AWS questions come from upstream and are unreviewed.
 */
export interface QuestionConfidence {
  rag: ConfidenceRag;
  /** The reviewer's own confidence in the keyed answer. */
  level: "high" | "medium" | "low";
  /** "docs": confirmed against Anthropic's documentation; "reasoning": a best-practice judgement. */
  basis: "docs" | "reasoning";
  /** The answer depends on platform behaviour that changed recently, so the live exam may lag. */
  timeSensitive: boolean;
  /** ISO date of the review. */
  reviewed: string;
  /** The question was reworded after review to remove ambiguous or outdated wording. */
  reworded?: boolean;
  /** Anthropic documentation pages that back the answer. */
  sources?: string[];
  /** Hash of the question, options, key and explanation the review covered. */
  contentHash?: string;
}

export interface Question {
  id: string;
  sourceFile: string;
  examSet: string;
  number: number;
  stem: string;
  options: QuestionOption[];
  correct: string[];
  multi: boolean;
  explanation: string;
  confidence?: QuestionConfidence;
}

export interface ExamData {
  examId: ExamId;
  examName: string;
  examShort: string;
  generatedAt: string;
  questionCount: number;
  questions: Question[];
}

export interface QuizConfig {
  examId: ExamId;
  feedback: FeedbackMode;
  length: number;
  shuffle: boolean;
}

export interface AnswerRecord {
  selected: string[];
  locked: boolean;
}

export interface QuizState {
  config: QuizConfig;
  questions: Question[];
  answers: Record<string, AnswerRecord>;
  cursor: number;
  startedAt: number;
  finishedAt: number | null;
}

export interface QuizResult {
  config: QuizConfig;
  questions: Question[];
  answers: Record<string, AnswerRecord>;
  startedAt: number;
  finishedAt: number;
  score: number;
  correctCount: number;
}
