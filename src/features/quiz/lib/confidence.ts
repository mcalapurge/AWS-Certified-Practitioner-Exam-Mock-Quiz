import type { ConfidenceRag, QuestionConfidence } from "../types";

// Kept free of runtime imports so tests/unit can load it directly with Node's
// type stripping (`import type` is erased).

export interface ConfidenceView {
  rag: ConfidenceRag;
  /** Two- or three-word label shown inline in the footnote. */
  label: string;
  /** Heading for the details popover. */
  headline: string;
  /** One-sentence explanation of what the rating means for this question. */
  summary: string;
  /** Extra caveats, in display order. */
  notes: string[];
  /** e.g. "Oct 2026", or null when the date is unparseable. */
  reviewedLabel: string | null;
}

export const RAG_LEGEND: { rag: ConfidenceRag; label: string; meaning: string }[] = [
  {
    rag: "green",
    label: "Verified",
    meaning: "Matched in blind review and confirmed in Anthropic's docs.",
  },
  {
    rag: "amber",
    label: "Best practice",
    meaning: "Matched in blind review, but rests on judgement or has caveats.",
  },
  {
    rag: "red",
    label: "Disputed",
    meaning: "A reviewer disagreed or couldn't verify it. Treat with caution.",
  },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Formats "2026-10-05" without Date parsing, which would shift by timezone.
export function formatReviewed(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : null;
}

export function describeConfidence(c: QuestionConfidence): ConfidenceView {
  const reviewedLabel = formatReviewed(c.reviewed);
  const notes: string[] = [];
  let label: string;
  let headline: string;
  let summary: string;

  if (c.rag === "green") {
    label = "Verified";
    headline = "Verified against Anthropic's docs";
    summary =
      "An independent reviewer answered this question without seeing the key, reached the same answer, and confirmed it in Anthropic's documentation.";
  } else if (c.rag === "amber") {
    if (c.level === "high" && c.basis === "reasoning") {
      label = "Best practice";
      headline = "Reviewed: a best-practice judgement";
      summary =
        "An independent reviewer reached the same answer without seeing the key, but it rests on engineering judgement rather than a specific documented fact, so the real exam may phrase it differently.";
    } else {
      label = "Reviewed, with caveats";
      headline = "Reviewed, with caveats";
      summary =
        "An independent reviewer reached the same answer without seeing the key, but with only medium confidence: read the explanation closely, as another option may be arguable.";
    }
  } else {
    label = "Disputed";
    headline = "Answer disputed";
    summary =
      "An independent reviewer disagreed with this answer or could not verify it. Treat the keyed answer with caution.";
  }

  if (c.reworded) {
    notes.push("Reworded after review to remove ambiguous or outdated wording.");
  }
  if (c.timeSensitive) {
    notes.push(
      `Recently changed: this reflects Claude platform behaviour${reviewedLabel ? ` as of ${reviewedLabel}` : ""}. The live exam may still expect the older behaviour.`,
    );
  }

  return { rag: c.rag, label, headline, summary, notes, reviewedLabel };
}

// "https://platform.claude.com/docs/en/build-with-claude/prompt-caching" -> "Prompt caching"
export function sourceTitle(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts.at(-1) ?? "";
    const words = decodeURIComponent(last).replace(/[-_]+/g, " ").trim();
    if (!words) return new URL(url).hostname;
    return words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    return url;
  }
}
