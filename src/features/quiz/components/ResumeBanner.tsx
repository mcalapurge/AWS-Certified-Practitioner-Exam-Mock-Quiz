import { Play, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { examMeta } from "../lib/exams";
import type { QuizState } from "../types";

interface Props {
  inProgress: QuizState;
  onResume: () => void;
  onDiscard: () => void;
}

export function ResumeBanner({ inProgress, onResume, onDiscard }: Props) {
  const exam = examMeta[inProgress.config.examId];
  const total = inProgress.questions.length;
  const cursor = inProgress.cursor + 1;
  const mode = inProgress.config.feedback === "instant" ? "instant feedback" : "submit at end";

  return (
    <Alert variant="info" className="flex items-center justify-between gap-4 mb-6">
      <Play />
      <div className="flex-1 min-w-0">
        <AlertTitle>Resume in-progress quiz</AlertTitle>
        <AlertDescription>
          {exam.examName} — question {cursor} of {total} • {mode}
        </AlertDescription>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" onClick={onResume}>
          Resume
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard} aria-label="Discard saved quiz">
          <X />
          Discard
        </Button>
      </div>
    </Alert>
  );
}
