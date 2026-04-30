import { useMemo } from "react";
import { ArrowLeft, ArrowRight, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { QuizState } from "../types";
import { answeredCount, emptyAnswer } from "../lib/scoring";
import { moveCursor, setQuestionSelection } from "../hooks/useQuiz";
import { QuestionCard } from "./QuestionCard";
import { QuestionGrid } from "./QuestionGrid";

interface Props {
  state: QuizState;
  onUpdate: (next: QuizState) => void;
  onLock: (questionId: string) => void;
  onFinish: () => void;
  onExit: () => void;
}

export function QuizScreen({ state, onUpdate, onLock, onFinish, onExit }: Props) {
  const q = state.questions[state.cursor];
  const answer = state.answers[q.id] ?? emptyAnswer();

  const progress = useMemo(() => {
    const answered = answeredCount(state);
    return {
      answered,
      total: state.questions.length,
      pct: state.questions.length === 0 ? 0 : (answered / state.questions.length) * 100,
    };
  }, [state]);

  const isLast = state.cursor === state.questions.length - 1;
  const allAnswered = progress.answered === progress.total;
  // In instant mode you must lock before moving on. End mode is free navigation.
  const canAdvance = state.config.feedback === "end" ? true : answer.locked;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onExit}>
          <LogOut />
          Save & exit
        </Button>
        <div className="flex-1 flex flex-col gap-1.5">
          <div className="flex justify-end text-xs text-muted-foreground tabular-nums">
            {progress.answered} / {progress.total} answered
          </div>
          <Progress value={progress.pct} />
        </div>
      </div>

      <QuestionCard
        question={q}
        index={state.cursor}
        total={state.questions.length}
        answer={answer}
        feedback={state.config.feedback}
        onChange={(selected) => onUpdate(setQuestionSelection(state, q.id, selected))}
        onLock={() => onLock(q.id)}
      />

      <nav className="flex justify-between gap-3 sm:flex-row flex-col-reverse">
        <Button
          variant="outline"
          disabled={state.cursor === 0}
          onClick={() => onUpdate(moveCursor(state, state.cursor - 1))}
          className="sm:w-auto w-full"
        >
          <ArrowLeft />
          Previous
        </Button>

        {!isLast ? (
          <Button
            disabled={!canAdvance}
            onClick={() => onUpdate(moveCursor(state, state.cursor + 1))}
            className="sm:w-auto w-full"
          >
            Next
            <ArrowRight />
          </Button>
        ) : (
          <Button
            disabled={!canAdvance && state.config.feedback === "instant"}
            onClick={onFinish}
            className="sm:w-auto w-full"
          >
            {state.config.feedback === "end" && !allAnswered
              ? `Submit (${progress.answered}/${progress.total})`
              : "Finish & see results"}
          </Button>
        )}
      </nav>

      <QuestionGrid state={state} onJump={(i) => onUpdate(moveCursor(state, i))} />
    </div>
  );
}
