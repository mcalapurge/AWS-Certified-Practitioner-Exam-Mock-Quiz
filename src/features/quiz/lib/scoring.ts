import type { AnswerRecord, ExamData, Question, QuizConfig, QuizResult, QuizState } from "../types";

function shuffleArray<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildQuiz(exam: ExamData, config: QuizConfig): QuizState {
  const pool = config.shuffle ? shuffleArray(exam.questions) : exam.questions.slice();
  const length = Math.min(config.length, pool.length);
  return {
    config,
    questions: pool.slice(0, length),
    answers: {},
    cursor: 0,
    startedAt: Date.now(),
    finishedAt: null,
  };
}

export function isAnswerCorrect(question: Question, selected: string[]): boolean {
  if (selected.length !== question.correct.length) return false;
  const a = [...selected].sort().join(",");
  const b = [...question.correct].sort().join(",");
  return a === b;
}

export function scoreQuiz(state: QuizState) {
  let correctCount = 0;
  for (const q of state.questions) {
    const ans = state.answers[q.id];
    if (ans && isAnswerCorrect(q, ans.selected)) correctCount++;
  }
  const score = state.questions.length === 0 ? 0 : correctCount / state.questions.length;
  return { correctCount, score };
}

export function finalize(state: QuizState): QuizResult {
  const { correctCount, score } = scoreQuiz(state);
  return {
    config: state.config,
    questions: state.questions,
    answers: state.answers,
    startedAt: state.startedAt,
    finishedAt: Date.now(),
    score,
    correctCount,
  };
}

export function emptyAnswer(): AnswerRecord {
  return { selected: [], locked: false };
}

export function answeredCount(state: QuizState): number {
  return state.questions.reduce((n, q) => {
    const a = state.answers[q.id];
    if (!a) return n;
    if (state.config.feedback === "instant") return a.locked ? n + 1 : n;
    return a.selected.length > 0 ? n + 1 : n;
  }, 0);
}
