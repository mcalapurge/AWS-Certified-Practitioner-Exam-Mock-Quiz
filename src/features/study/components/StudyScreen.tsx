import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ExamId } from "../../quiz/types";
import { examMeta } from "../../quiz/lib/exams";
import { studyData, groupSections } from "../lib/sections";
import type { Section } from "../types";
import type { SectionGroup } from "../lib/sections";
import { SectionPicker, type SectionRowAdornment } from "./SectionPicker";
import { MarkdownView } from "./MarkdownView";
import { useStudyGuide } from "../hooks/useStudyGuide";

const LAST_VIEWED_KEY = "examprep:v1:study-last";

interface LastViewed {
  examId: ExamId;
  sectionId: string;
}

function loadLastViewed(): LastViewed | null {
  try {
    const raw = window.localStorage.getItem(LAST_VIEWED_KEY);
    return raw ? (JSON.parse(raw) as LastViewed) : null;
  } catch {
    return null;
  }
}

function saveLastViewed(value: LastViewed) {
  try {
    window.localStorage.setItem(LAST_VIEWED_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

interface Props {
  onExit: () => void;
}

export function StudyScreen({ onExit }: Props) {
  const [examId, setExamId] = useState<ExamId>("ai-practitioner");
  const data = studyData[examId];
  const allGroups = useMemo(() => groupSections(data), [data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { entriesFor, toggleMastered, clearDone } = useStudyGuide();
  const guideEntries = entriesFor(examId);

  // Build a "Your study guide" group at the top of the sidebar that surfaces
  // the user's flagged-but-unmastered topics (mastered ones still appear,
  // styled as struck-through, until they explicitly clear them).
  const studyGuideGroup: SectionGroup | null = useMemo(() => {
    if (guideEntries.length === 0) return null;
    const sectionsById = new Map(data.sections.map((s) => [s.id, s]));
    const matched = guideEntries
      .map((e) => sectionsById.get(e.topicId))
      .filter((s): s is Section => !!s)
      .sort((a, b) => {
        const ea = guideEntries.find((e) => e.topicId === a.id)!;
        const eb = guideEntries.find((e) => e.topicId === b.id)!;
        // Unmastered first, then by hits desc, then by recency.
        if (ea.mastered !== eb.mastered) return ea.mastered ? 1 : -1;
        if (eb.hits !== ea.hits) return eb.hits - ea.hits;
        return eb.lastSeenAt - ea.lastSeenAt;
      });
    if (matched.length === 0) return null;
    return {
      category: "__study_guide__",
      label: "Your study guide",
      sections: matched,
    };
  }, [data.sections, guideEntries]);

  const groups = useMemo(
    () => (studyGuideGroup ? [studyGuideGroup, ...allGroups] : allGroups),
    [studyGuideGroup, allGroups]
  );

  const adornments = useMemo(() => {
    if (!studyGuideGroup) return undefined;
    const map: Record<string, SectionRowAdornment> = {};
    for (const e of guideEntries) {
      map[e.topicId] = {
        mastered: e.mastered,
        hits: e.hits,
        onToggleMastered: (next) => toggleMastered(e.topicId, next),
      };
    }
    return map;
  }, [studyGuideGroup, guideEntries, toggleMastered]);

  const guideStats = useMemo(() => {
    const total = guideEntries.length;
    const done = guideEntries.filter((e) => e.mastered).length;
    return { total, done, remaining: total - done };
  }, [guideEntries]);

  // Hydrate last-viewed selection on mount.
  useEffect(() => {
    const last = loadLastViewed();
    if (last && studyData[last.examId]) {
      const found = studyData[last.examId].sections.find((s) => s.id === last.sectionId);
      if (found) {
        setExamId(last.examId);
        setSelectedId(found.id);
        return;
      }
    }
    // Fall back to the first section of the default exam.
    setSelectedId(data.sections[0]?.id ?? null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When the exam picker changes, default-select that exam's first section.
  function changeExam(id: ExamId) {
    setExamId(id);
    const first = studyData[id].sections[0];
    if (first) {
      setSelectedId(first.id);
      saveLastViewed({ examId: id, sectionId: first.id });
    }
  }

  function selectSection(section: Section) {
    setSelectedId(section.id);
    saveLastViewed({ examId: section.examId, sectionId: section.id });
  }

  const selected = useMemo(
    () => data.sections.find((s) => s.id === selectedId) ?? null,
    [data, selectedId]
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onExit}>
          <ArrowLeft />
          Back to setup
        </Button>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Exam:</span>
          {(Object.keys(examMeta) as ExamId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => changeExam(id)}
              className={
                "px-2 py-1 border text-xs font-medium transition-colors " +
                (examId === id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-accent")
              }
            >
              {examMeta[id].examShort}
            </button>
          ))}
        </div>
      </div>

      {guideStats.total > 0 && (
        <div className="flex items-start gap-3 border border-primary/40 bg-primary/5 px-4 py-3 text-sm">
          <Sparkles className="size-4 mt-0.5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium">
              {guideStats.remaining > 0 ? (
                <>
                  {guideStats.remaining} topic{guideStats.remaining === 1 ? "" : "s"} in your study guide
                </>
              ) : (
                <>All flagged topics mastered — nice work.</>
              )}
            </div>
            <div className="text-muted-foreground text-xs">
              Topics from incorrect answers are added here. Tick the box once you feel confident.
            </div>
          </div>
          {guideStats.done > 0 && (
            <Button variant="ghost" size="sm" onClick={clearDone}>
              <Trash2 />
              Clear mastered
            </Button>
          )}
        </div>
      )}

      <Card>
        <CardContent className="grid gap-0 p-0 md:grid-cols-[280px_1fr]">
          <aside className="border-b md:border-b-0 md:border-r p-4 md:max-h-[calc(100vh-180px)] md:overflow-y-auto">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="size-4" />
              <span>{data.examShort} topics</span>
              <span className="text-muted-foreground font-normal">
                ({data.sectionCount})
              </span>
            </div>
            <SectionPicker
              groups={groups}
              selectedId={selectedId}
              onSelect={selectSection}
              adornments={adornments}
            />
          </aside>
          <article className="p-6 md:max-h-[calc(100vh-180px)] md:overflow-y-auto">
            {selected ? (
              <MarkdownView content={selected.content} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Pick a topic to start reading.
              </p>
            )}
          </article>
        </CardContent>
      </Card>
    </div>
  );
}
