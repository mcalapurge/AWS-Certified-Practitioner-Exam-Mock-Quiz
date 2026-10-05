import { Clock, ExternalLink, Info, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ConfidenceRag, QuestionConfidence } from "../types";
import { RAG_LEGEND, describeConfidence, sourceTitle } from "../lib/confidence";

// Icon shape differs per status as well as colour, so the rating doesn't rely on colour alone.
const RAG_ICON = { green: ShieldCheck, amber: ShieldQuestion, red: ShieldAlert } as const;
const RAG_TEXT: Record<ConfidenceRag, string> = {
  green: "text-success",
  amber: "text-warning",
  red: "text-destructive",
};

interface Props {
  confidence: QuestionConfidence;
  /** Sources can hint at the answer, so they're listed only once it's been revealed. */
  revealed: boolean;
  className?: string;
}

export function ConfidenceFootnote({ confidence, revealed, className }: Props) {
  const view = describeConfidence(confidence);
  const Icon = RAG_ICON[view.rag];
  const sources = confidence.sources ?? [];

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs", className)}>
      <Popover>
        <PopoverTrigger
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 -mx-1.5 text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label={`Answer confidence: ${view.label}. Show details`}
          data-rag={view.rag}
        >
          <Icon className={cn("size-4 shrink-0", RAG_TEXT[view.rag])} aria-hidden />
          <span>
            Answer confidence: <span className="font-medium text-foreground">{view.label}</span>
          </span>
          <Info className="size-3.5 shrink-0 opacity-70" aria-hidden />
        </PopoverTrigger>
        <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] text-sm" align="start">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <Icon className={cn("size-5 shrink-0 mt-0.5", RAG_TEXT[view.rag])} aria-hidden />
              <div className="font-semibold leading-snug">{view.headline}</div>
            </div>
            <p className="text-muted-foreground leading-relaxed">{view.summary}</p>
            {view.notes.map((n) => (
              <p key={n} className="text-muted-foreground leading-relaxed">
                {n}
              </p>
            ))}
            {sources.length > 0 &&
              (revealed ? (
                <div>
                  <div className="text-xs font-medium mb-1">Backed by</div>
                  <ul className="flex flex-col gap-1">
                    {sources.map((u) => (
                      <li key={u}>
                        <a
                          href={u}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                        >
                          {sourceTitle(u)}
                          <ExternalLink className="size-3" aria-hidden />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Documentation links appear once you've answered.
                </p>
              ))}
            <div className="border-t pt-2 flex flex-col gap-1">
              {RAG_LEGEND.map((l) => {
                const LegendIcon = RAG_ICON[l.rag];
                return (
                  <div
                    key={l.rag}
                    className={cn(
                      "flex items-start gap-2 text-xs",
                      l.rag === view.rag ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <LegendIcon
                      className={cn("size-3.5 shrink-0 mt-0.5", RAG_TEXT[l.rag])}
                      aria-hidden
                    />
                    <span>
                      <span className="font-medium">{l.label}</span>: {l.meaning}
                    </span>
                  </div>
                );
              })}
              {view.reviewedLabel && (
                <div className="text-xs text-muted-foreground mt-1">
                  Reviewed {view.reviewedLabel}
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {confidence.timeSensitive && (
        <span
          className="inline-flex items-center gap-1 text-muted-foreground"
          title="This answer reflects recently changed Claude platform behaviour; the live exam may lag."
        >
          <Clock className="size-3.5 shrink-0 text-warning" aria-hidden />
          Recently changed
        </span>
      )}
    </div>
  );
}
