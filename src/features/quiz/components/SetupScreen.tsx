import { useMemo, useState } from "react";
import { ArrowRight, BookOpen, Loader2, Shuffle, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ExamId, FeedbackMode, QuizConfig, QuizState } from "../types";
import { examMeta, examMetaList } from "../lib/exams";
import { ResumeBanner } from "./ResumeBanner";
import { useStudyGuide } from "../../study/hooks/useStudyGuide";

const LENGTH_PRESETS = [10, 25, 50, 65];

interface Props {
  inProgress: QuizState | null;
  starting: boolean;
  onStart: (config: QuizConfig) => void;
  onResume: () => void;
  onDiscard: () => void;
  onOpenStudy: () => void;
}

export function SetupScreen({
  inProgress,
  starting,
  onStart,
  onResume,
  onDiscard,
  onOpenStudy,
}: Props) {
  const [examId, setExamId] = useState<ExamId>("ai-practitioner");
  const [feedback, setFeedback] = useState<FeedbackMode>("instant");
  const [length, setLength] = useState<number>(25);
  const [shuffle, setShuffle] = useState<boolean>(true);

  const exam = examMeta[examId];
  const maxLen = exam.questionCount;

  const { entriesFor } = useStudyGuide();
  const guideForExam = entriesFor(examId);
  const guideRemaining = guideForExam.filter((e) => !e.mastered).length;

  const presets = useMemo(() => {
    const set = new Set<number>(LENGTH_PRESETS.filter((n) => n <= maxLen));
    set.add(maxLen);
    return Array.from(set).sort((a, b) => a - b);
  }, [maxLen]);

  const totalQuestions =
    examMeta["cloud-practitioner"].questionCount + examMeta["ai-practitioner"].questionCount;

  return (
    <div>
      {inProgress && (
        <ResumeBanner inProgress={inProgress} onResume={onResume} onDiscard={onDiscard} />
      )}

      {guideRemaining > 0 && (
        <button
          type="button"
          onClick={onOpenStudy}
          className="mb-6 w-full flex items-center gap-3 border border-primary/40 bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Sparkles className="size-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">
              {guideRemaining} weak topic{guideRemaining === 1 ? "" : "s"} for {exam.examShort}
            </div>
            <div className="text-xs text-muted-foreground">
              From recent incorrect answers. Tap to review and tick off.
            </div>
          </div>
          <ArrowRight className="size-4 text-muted-foreground shrink-0" />
        </button>
      )}

      <Card>
        <CardHeader>
          <CardTitle>AWS Exam Practice</CardTitle>
          <CardDescription>
            {totalQuestions} questions across two exams. Pick a setup and go.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-7">
          <Section title="Exam">
            <div className="grid gap-3 sm:grid-cols-2">
              {examMetaList.map((e) => (
                <OptionCard
                  key={e.examId}
                  selected={examId === e.examId}
                  onSelect={() => setExamId(e.examId)}
                  title={e.examName}
                  description={`${e.examShort} • ${e.questionCount} questions`}
                />
              ))}
            </div>
          </Section>

          <Section title="Feedback">
            <div className="grid gap-3 sm:grid-cols-2">
              <OptionCard
                selected={feedback === "instant"}
                onSelect={() => setFeedback("instant")}
                title="Instant feedback"
                description="Lock in each answer, see correctness immediately"
              />
              <OptionCard
                selected={feedback === "end"}
                onSelect={() => setFeedback("end")}
                title="Submit at end"
                description="Exam-style — only see results after submitting"
              />
            </div>
          </Section>

          <Section title="Length">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-wrap gap-2">
                {presets.map((n) => (
                  <Button
                    key={n}
                    type="button"
                    variant={length === n ? "default" : "outline"}
                    size="sm"
                    className="rounded-full"
                    onClick={() => setLength(n)}
                  >
                    {n === maxLen ? `All (${n})` : n}
                  </Button>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="length-custom" className="text-xs text-muted-foreground">
                  Custom
                </Label>
                <Input
                  id="length-custom"
                  type="number"
                  min={1}
                  max={maxLen}
                  value={length}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (Number.isFinite(v)) setLength(Math.max(1, Math.min(maxLen, v)));
                  }}
                  className="w-24"
                />
              </div>
            </div>
          </Section>

          <Section title="Order">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <Checkbox
                checked={shuffle}
                onCheckedChange={(v) => setShuffle(v === true)}
              />
              <Shuffle className="size-4 text-muted-foreground" />
              <span className="text-sm">Shuffle questions (randomly drawn from the pool)</span>
            </label>
          </Section>

          <div className="flex justify-between items-center pt-2 gap-3 flex-wrap">
            <Button variant="outline" onClick={onOpenStudy} disabled={starting}>
              <BookOpen />
              Study notes
            </Button>
            <Button
              size="lg"
              disabled={starting || length < 1 || length > maxLen}
              onClick={() => onStart({ examId, feedback, length, shuffle })}
            >
              {starting ? (
                <>
                  <Loader2 className="animate-spin" />
                  Loading questions…
                </>
              ) : (
                <>
                  Start new quiz
                  <ArrowRight />
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

interface OptionCardProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}

function OptionCard({ selected, onSelect, title, description }: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative text-left rounded-lg border p-4 transition-all",
        "bg-card hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary ring-2 ring-primary/40 bg-primary/5"
          : "border-border"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 size-4 rounded-full border-2 transition-colors shrink-0",
            selected ? "border-primary bg-primary" : "border-muted-foreground/40"
          )}
        />
        <div className="flex flex-col gap-1 min-w-0">
          <div className="font-semibold text-sm leading-tight">{title}</div>
          <div className="text-xs text-muted-foreground leading-snug">{description}</div>
        </div>
      </div>
    </button>
  );
}
