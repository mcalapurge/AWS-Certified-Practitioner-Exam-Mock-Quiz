import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnswerRecord, QuizConfig, QuizResult, QuizState } from "../types";
import { loadExam } from "../lib/exams";
import { buildQuiz, emptyAnswer, finalize, isAnswerCorrect } from "../lib/scoring";
import { mapQuestionToTopics } from "../../study/lib/topics";
import { addTopics, loadStudyGuide, saveStudyGuide } from "../../study/lib/study-guide";
import {
  appendHistory,
  clearInProgress,
  loadInProgress,
  saveInProgress,
} from "../lib/storage";

export type View =
  | { kind: "setup" }
  | { kind: "quiz"; state: QuizState }
  | { kind: "results"; result: QuizResult };

const PERSIST_DEBOUNCE_MS = 200;

export function useQuiz() {
  const [view, setView] = useState<View>({ kind: "setup" });
  const [inProgress, setInProgress] = useState<QuizState | null>(null);
  // True while the dynamic-imported exam JSON is being fetched.
  const [starting, setStarting] = useState(false);

  // Hydrate any saved quiz on mount.
  useEffect(() => {
    const saved = loadInProgress();
    if (saved && saved.questions?.length) setInProgress(saved);
  }, []);

  // Debounced persistence so rapid keypresses don't thrash localStorage.
  const persistTimer = useRef<number | null>(null);
  useEffect(() => {
    if (view.kind !== "quiz") return;
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      saveInProgress(view.state);
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
    };
  }, [view]);

  const startQuiz = useCallback(async (config: QuizConfig) => {
    setStarting(true);
    try {
      const exam = await loadExam(config.examId);
      const state = buildQuiz(exam, config);
      saveInProgress(state);
      setInProgress(state);
      setView({ kind: "quiz", state });
    } finally {
      setStarting(false);
    }
  }, []);

  const resumeQuiz = useCallback(() => {
    if (!inProgress) return;
    setView({ kind: "quiz", state: inProgress });
  }, [inProgress]);

  const discardInProgress = useCallback(() => {
    clearInProgress();
    setInProgress(null);
  }, []);

  const updateQuiz = useCallback((next: QuizState) => {
    setView({ kind: "quiz", state: next });
    setInProgress(next);
  }, []);

  const finishQuiz = useCallback(() => {
    if (view.kind !== "quiz") return;
    const result = finalize(view.state);
    // Side effects run before setState so React StrictMode's double-invocation
    // of updater functions doesn't double-fire localStorage writes.
    appendHistory(result);
    if (result.config.feedback === "end") {
      // Instant mode flags topics in real-time on each lock — re-flagging here
      // would double-count `hits`. Only end-mode aggregates at submission.
      addIncorrectTopicsToGuide(result);
    }
    clearInProgress();
    setInProgress(null);
    setView({ kind: "results", result });
    window.dispatchEvent(new Event("examprep:study-guide-changed"));
  }, [view]);

  // Instant-feedback variant of locking: applies the lock and, if the answer
  // was wrong, immediately maps the question to study topics so the guide
  // reflects the user's gaps without waiting for them to finish the quiz.
  const lockAnswer = useCallback(
    (questionId: string) => {
      if (view.kind !== "quiz") return;
      const next = lockQuestion(view.state, questionId);
      if (next.config.feedback === "instant") {
        const q = next.questions.find((qq) => qq.id === questionId);
        const ans = next.answers[questionId];
        if (q && ans && !isAnswerCorrect(q, ans.selected)) {
          const topicIds = mapQuestionToTopics(q, next.config.examId);
          if (topicIds.length) {
            saveStudyGuide(
              addTopics(loadStudyGuide(), topicIds, next.config.examId)
            );
            window.dispatchEvent(new Event("examprep:study-guide-changed"));
          }
        }
      }
      setInProgress(next);
      setView({ kind: "quiz", state: next });
    },
    [view]
  );

  const exitToSetup = useCallback(() => {
    setView({ kind: "setup" });
  }, []);

  const restart = useCallback(() => {
    setView({ kind: "setup" });
  }, []);

  return useMemo(
    () => ({
      view,
      inProgress,
      starting,
      startQuiz,
      resumeQuiz,
      discardInProgress,
      updateQuiz,
      lockAnswer,
      finishQuiz,
      exitToSetup,
      restart,
    }),
    [
      view,
      inProgress,
      starting,
      startQuiz,
      resumeQuiz,
      discardInProgress,
      updateQuiz,
      lockAnswer,
      finishQuiz,
      exitToSetup,
      restart,
    ]
  );
}

// Walks the finalized quiz, finds every incorrect question, and unions their
// mapped study topics into the user's persistent study guide. Mastered topics
// re-flag with a bumped `hits` counter but stay marked mastered (the user's
// call) — see addTopics in lib/study-guide.ts.
function addIncorrectTopicsToGuide(result: QuizResult) {
  const wrongTopicIds = new Set<string>();
  for (const q of result.questions) {
    const ans = result.answers[q.id];
    if (ans && isAnswerCorrect(q, ans.selected)) continue;
    for (const id of mapQuestionToTopics(q, result.config.examId)) {
      wrongTopicIds.add(id);
    }
  }
  if (wrongTopicIds.size === 0) return;
  saveStudyGuide(addTopics(loadStudyGuide(), [...wrongTopicIds], result.config.examId));
}

// Helpers for components that mutate a single question's answer record.
export function setQuestionSelection(
  state: QuizState,
  questionId: string,
  selected: string[]
): QuizState {
  const prev = state.answers[questionId] ?? emptyAnswer();
  return {
    ...state,
    answers: {
      ...state.answers,
      [questionId]: { selected, locked: prev.locked },
    },
  };
}

export function lockQuestion(state: QuizState, questionId: string): QuizState {
  const prev: AnswerRecord = state.answers[questionId] ?? emptyAnswer();
  return {
    ...state,
    answers: {
      ...state.answers,
      [questionId]: { selected: prev.selected, locked: true },
    },
  };
}

export function moveCursor(state: QuizState, idx: number): QuizState {
  if (idx < 0 || idx >= state.questions.length) return state;
  return { ...state, cursor: idx };
}
