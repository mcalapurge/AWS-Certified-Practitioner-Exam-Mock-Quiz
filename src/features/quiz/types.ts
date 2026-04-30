export type ExamId = "cloud-practitioner" | "ai-practitioner";

export type FeedbackMode = "instant" | "end";

export interface QuestionOption {
  key: string;
  text: string;
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
