import { ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { Section } from "../types";
import type { SectionGroup } from "../lib/sections";

export interface SectionRowAdornment {
  // When provided, renders a checkbox that controls a "mastered" state for
  // the row. Used by the study-guide group to let users tick off topics.
  mastered?: boolean;
  onToggleMastered?: (next: boolean) => void;
  hits?: number;
}

interface Props {
  groups: SectionGroup[];
  selectedId: string | null;
  onSelect: (section: Section) => void;
  // Map of section.id → optional adornments. Sparse: rows without an entry
  // render as plain rows.
  adornments?: Record<string, SectionRowAdornment>;
}

export function SectionPicker({ groups, selectedId, onSelect, adornments }: Props) {
  return (
    <nav className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.category ?? "_"} className="flex flex-col gap-1.5">
          {group.category && (
            <h3 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </h3>
          )}
          <ul className="flex flex-col">
            {group.sections.map((s) => {
              const adorn = adornments?.[s.id];
              const isCurrent = selectedId === s.id;
              return (
                <li key={s.id} className="flex items-stretch">
                  {adorn && (
                    <label
                      className="flex items-center pl-2 pr-1 cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                      title={adorn.mastered ? "Mark as not mastered" : "Mark as mastered"}
                    >
                      <Checkbox
                        checked={!!adorn.mastered}
                        onCheckedChange={(v) => adorn.onToggleMastered?.(v === true)}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => onSelect(s)}
                    className={cn(
                      "group flex-1 flex items-center justify-between gap-2 px-2 py-1.5 text-left text-sm transition-colors",
                      "hover:bg-accent hover:text-accent-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isCurrent && "bg-accent text-accent-foreground font-medium",
                      adorn?.mastered && "text-muted-foreground line-through decoration-muted-foreground/50"
                    )}
                    aria-current={isCurrent ? "page" : undefined}
                  >
                    <span className="truncate">{s.title}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {adorn?.hits != null && adorn.hits > 1 && !adorn.mastered && (
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 bg-destructive/10 text-destructive border border-destructive/30"
                          title={`${adorn.hits} incorrect questions linked to this topic`}
                        >
                          ×{adorn.hits}
                        </span>
                      )}
                      <ChevronRight
                        className={cn(
                          "size-3.5 text-muted-foreground transition-opacity",
                          isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
