import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AnswerRecord, FeedbackMode, Question } from "../types";
import { isAnswerCorrect } from "../lib/scoring";
import { RichText } from "./RichText";

interface Props {
  question: Question;
  index: number;
  total: number;
  answer: AnswerRecord;
  feedback: FeedbackMode;
  onChange: (selected: string[]) => void;
  onLock: () => void;
}

export function QuestionCard({
  question,
  index,
  total,
  answer,
  feedback,
  onChange,
  onLock,
}: Props) {
  const showResult = feedback === "instant" && answer.locked;
  const isCorrect = showResult && isAnswerCorrect(question, answer.selected);

  function toggle(key: string) {
    if (showResult) return;
    if (question.multi) {
      const has = answer.selected.includes(key);
      onChange(has ? answer.selected.filter((k) => k !== key) : [...answer.selected, key]);
    } else {
      onChange([key]);
    }
  }

  const canLock =
    feedback === "instant" &&
    !answer.locked &&
    answer.selected.length > 0 &&
    (question.multi ? answer.selected.length === question.correct.length : true);

  return (
    <Card>
      <CardContent className="pt-6 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            Question {index + 1} / {total}
          </span>
          <Badge variant="secondary">
            {question.multi ? `Choose ${question.correct.length}` : "Single answer"}
          </Badge>
        </div>

        <h2 className="text-lg font-semibold leading-snug">{question.stem}</h2>

        <ul className="flex flex-col gap-2.5">
          {question.options.map((opt) => {
            const selected = answer.selected.includes(opt.key);
            const correct = question.correct.includes(opt.key);
            return (
              <li key={opt.key}>
                <OptionButton
                  optKey={opt.key}
                  text={opt.text}
                  selected={selected}
                  correct={correct}
                  showResult={showResult}
                  onClick={() => toggle(opt.key)}
                  disabled={showResult}
                />
              </li>
            );
          })}
        </ul>

        {feedback === "instant" && !answer.locked && (
          <div className="flex items-center gap-3 flex-wrap">
            <Button disabled={!canLock} onClick={onLock}>
              Submit answer
            </Button>
            {question.multi && answer.selected.length !== question.correct.length && (
              <span className="text-xs text-muted-foreground">
                Select {question.correct.length} option{question.correct.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        {showResult && (
          <ResultBanner question={question} correct={isCorrect} />
        )}
      </CardContent>
    </Card>
  );
}

function OptionButton({
  optKey,
  text,
  selected,
  correct,
  showResult,
  onClick,
  disabled,
}: {
  optKey: string;
  text: string;
  selected: boolean;
  correct: boolean;
  showResult: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  const stateClass = (() => {
    if (!showResult) {
      return selected
        ? "border-primary bg-primary/10"
        : "border-border hover:border-primary/60";
    }
    if (selected && correct) return "border-success bg-success/10 text-foreground";
    if (selected && !correct) return "border-destructive bg-destructive/10 text-foreground";
    if (!selected && correct) return "border-success bg-success/5 outline outline-1 outline-dashed outline-success";
    return "border-border opacity-70";
  })();

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "w-full flex items-start gap-3 text-left rounded-lg border bg-card px-4 py-3 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-default",
        stateClass
      )}
    >
      <span
        className={cn(
          "shrink-0 grid place-items-center size-7 rounded-md border bg-background text-xs font-semibold",
          selected && !showResult && "border-primary text-primary",
          showResult && correct && "border-success text-success"
        )}
      >
        {optKey}
      </span>
      <span className="flex-1 leading-relaxed text-sm">{text}</span>
    </button>
  );
}

function ResultBanner({ question, correct }: { question: Question; correct: boolean }) {
  return (
    <div
      className={cn(
        "border px-4 py-3 flex gap-3",
        correct ? "border-success/60 bg-success/10" : "border-destructive/60 bg-destructive/10"
      )}
    >
      {correct ? (
        <CheckCircle2 className="size-5 shrink-0 mt-0.5 text-success" />
      ) : (
        <XCircle className="size-5 shrink-0 mt-0.5 text-destructive" />
      )}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-semibold">{correct ? "Correct" : "Incorrect"}</span>
          <span className="text-sm text-muted-foreground">
            Answer: {question.correct.join(", ")}
          </span>
        </div>
        {question.explanation && (
          <RichText
            text={question.explanation}
            className="text-sm text-muted-foreground leading-relaxed"
          />
        )}
      </div>
    </div>
  );
}
