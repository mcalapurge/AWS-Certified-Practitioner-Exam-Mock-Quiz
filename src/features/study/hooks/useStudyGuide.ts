import { useCallback, useEffect, useState } from "react";
import type { ExamId } from "../../quiz/types";
import type { StudyGuide, StudyGuideEntry } from "../types";
import {
  addTopics,
  clearMastered,
  entriesForExam,
  loadStudyGuide,
  removeTopic,
  saveStudyGuide,
  setMastered,
} from "../lib/study-guide";

const EVENT = "examprep:study-guide-changed";

function broadcast() {
  window.dispatchEvent(new Event(EVENT));
}

export function useStudyGuide() {
  const [guide, setGuide] = useState<StudyGuide>(() =>
    typeof window === "undefined" ? {} : loadStudyGuide()
  );

  // Re-hydrate on mount and on cross-component updates so opening the study
  // screen after finishing a quiz sees fresh entries without prop drilling.
  useEffect(() => {
    const sync = () => setGuide(loadStudyGuide());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const persist = useCallback((next: StudyGuide) => {
    saveStudyGuide(next);
    setGuide(next);
    broadcast();
  }, []);

  const addForExam = useCallback(
    (topicIds: string[], examId: ExamId) => {
      if (!topicIds.length) return;
      persist(addTopics(loadStudyGuide(), topicIds, examId));
    },
    [persist]
  );

  const toggleMastered = useCallback(
    (topicId: string, mastered: boolean) => {
      persist(setMastered(loadStudyGuide(), topicId, mastered));
    },
    [persist]
  );

  const remove = useCallback(
    (topicId: string) => {
      persist(removeTopic(loadStudyGuide(), topicId));
    },
    [persist]
  );

  const clearDone = useCallback(() => {
    persist(clearMastered(loadStudyGuide()));
  }, [persist]);

  return {
    guide,
    entriesFor: (examId: ExamId): StudyGuideEntry[] => entriesForExam(guide, examId),
    addForExam,
    toggleMastered,
    remove,
    clearDone,
  };
}
