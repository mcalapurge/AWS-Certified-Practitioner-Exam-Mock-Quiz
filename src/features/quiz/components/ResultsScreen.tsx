import { useState } from "react";
import { RotateCcw, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { QuizResult } from "../types";
import { isAnswerCorrect } from "../lib/scoring";
import { RichText } from "./RichText";

type Filter = "all" | "wrong" | "right";

interface Props {
  result: QuizResult;
  examName: string;
  onRestart: () => void;
}

export function ResultsScreen({ result, examName, onRestart }: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const pct = Math.round(result.score * 100);
  const passed = pct >= 70;
  const minutes = Math.max(1, Math.round((result.finishedAt - result.startedAt) / 60000));

  const filtered = result.questions.filter((q) => {
    const ans = result.answers[q.id];
    const correct = ans ? isAnswerCorrect(q, ans.selected) : false;
    if (filter === "wrong") return !correct;
    if (filter === "right") return correct;
    return true;
  });

  return (
    <Card>
      <CardContent className="pt-6 flex flex-col gap-5">
        <div
          className={cn(
            "flex items-center justify-between gap-4 rounded-xl border p-5",
            passed ? "border-success/60 bg-success/10" : "border-destructive/60 bg-destructive/10"
          )}
        >
          <div className="flex items-center gap-4">
            <Trophy
              className={cn(
                "size-10 shrink-0",
                passed ? "text-success" : "text-destructive"
              )}
            />
            <div>
              <div className="text-3xl font-bold tabular-nums tracking-tight">{pct}%</div>
              <div className="text-sm text-muted-foreground">
                {result.correctCount} / {result.questions.length} correct
              </div>
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-medium">{examName}</div>
            <div className="text-muted-foreground">
              ~{minutes} min • {result.config.feedback === "instant" ? "instant feedback" : "submit at end"}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="all">All ({result.questions.length})</TabsTrigger>
              <TabsTrigger value="wrong">
                Incorrect ({result.questions.length - result.correctCount})
              </TabsTrigger>
              <TabsTrigger value="right">Correct ({result.correctCount})</TabsTrigger>
            </TabsList>
          </Tabs>

          <Button onClick={onRestart}>
            <RotateCcw />
            New quiz
          </Button>
        </div>

        <ol className="flex flex-col gap-3">
          {filtered.map((q) => {
            const ans = result.answers[q.id];
            const selected = ans?.selected ?? [];
            const correct = isAnswerCorrect(q, selected);
            return (
              <li
                key={q.id}
                className={cn(
                  "rounded-xl border-l-4 border bg-card p-4",
                  correct ? "border-l-success" : "border-l-destructive"
                )}
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <Badge variant="outline">Q{q.number}</Badge>
                  <Badge variant={correct ? "success" : "destructive"}>
                    {correct ? "Correct" : "Incorrect"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{q.examSet}</span>
                </div>
                <p className="font-medium leading-snug mb-3">{q.stem}</p>
                <ul className="flex flex-col gap-1.5 mb-2">
                  {q.options.map((o) => {
                    const isSel = selected.includes(o.key);
                    const isCor = q.correct.includes(o.key);
                    const cls = (() => {
                      if (isSel && isCor) return "border-success bg-success/10";
                      if (isSel && !isCor) return "border-destructive bg-destructive/10";
                      if (!isSel && isCor) return "border-success bg-success/5 outline outline-1 outline-dashed outline-success";
                      return "border-border bg-card";
                    })();
                    return (
                      <li
                        key={o.key}
                        className={cn(
                          "flex items-start gap-3 rounded-md border px-3 py-2 text-sm",
                          cls
                        )}
                      >
                        <span className="shrink-0 grid place-items-center size-6 rounded border bg-background text-xs font-semibold">
                          {o.key}
                        </span>
                        <span className="flex-1 leading-relaxed">{o.text}</span>
                      </li>
                    );
                  })}
                </ul>
                {q.explanation && (
                  <RichText
                    text={q.explanation}
                    className="text-xs text-muted-foreground leading-relaxed mt-2"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
