import { cn } from "@/lib/utils";
import type { QuizState } from "../types";
import { isAnswerCorrect } from "../lib/scoring";

interface Props {
  state: QuizState;
  onJump: (idx: number) => void;
}

export function QuestionGrid({ state, onJump }: Props) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(38px, 1fr))" }}
      >
        {state.questions.map((q, i) => {
          const a = state.answers[q.id];
          let stateClass = "border-border bg-secondary text-muted-foreground hover:border-primary/60 hover:text-foreground";

          if (a) {
            if (state.config.feedback === "instant" && a.locked) {
              stateClass = isAnswerCorrect(q, a.selected)
                ? "border-success bg-success/15 text-foreground"
                : "border-destructive bg-destructive/15 text-foreground";
            } else if (a.selected.length > 0) {
              stateClass = "border-primary/40 bg-primary/15 text-foreground";
            }
          }

          return (
            <button
              key={q.id}
              type="button"
              onClick={() => onJump(i)}
              title={`Question ${i + 1}`}
              className={cn(
                "h-9 rounded-md border text-sm font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                stateClass,
                i === state.cursor && "ring-2 ring-primary"
              )}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
