import { lazy, Suspense, useState } from "react";
import { ScrollText } from "lucide-react";
import { useQuiz } from "@/features/quiz/hooks/useQuiz";
import { examMeta } from "@/features/quiz/lib/exams";
import { SetupScreen } from "@/features/quiz/components/SetupScreen";
import { QuizScreen } from "@/features/quiz/components/QuizScreen";
import { ResultsScreen } from "@/features/quiz/components/ResultsScreen";
import { Card, CardContent } from "@/components/ui/card";

// Study mode pulls in react-markdown + remark-gfm + ~400KB of section JSON.
// Lazy-load so the practice flow stays lean for users who never open notes.
const StudyScreen = lazy(() =>
  import("@/features/study/components/StudyScreen").then((m) => ({
    default: m.StudyScreen,
  }))
);

export default function App() {
  const {
    view,
    inProgress,
    starting,
    startQuiz,
    resumeQuiz,
    discardInProgress,
    updateQuiz,
    lockAnswer,
    finishQuiz,
    exitToSetup,
    restart,
  } = useQuiz();

  // Study mode is independent of the quiz state machine — it overlays the
  // setup screen rather than interrupting an in-progress quiz.
  const [studyOpen, setStudyOpen] = useState(false);

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="max-w-3xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
            <span className="grid place-items-center size-8 rounded-md bg-primary text-primary-foreground">
              <ScrollText className="size-4" />
            </span>
            <span>AWS Exam Practice</span>
          </div>
          {view.kind === "quiz" && (
            <span className="text-xs text-muted-foreground">
              {examMeta[view.state.config.examId].examShort} •{" "}
              {view.state.config.feedback === "instant" ? "instant" : "submit at end"}
            </span>
          )}
        </div>
      </header>

      <main
        className={
          studyOpen
            ? "flex-1 w-full max-w-6xl mx-auto px-5 pt-7 pb-20"
            : "flex-1 w-full max-w-3xl mx-auto px-5 pt-7 pb-20"
        }
      >
        {studyOpen && view.kind === "setup" && (
          <Suspense fallback={<StudyFallback />}>
            <StudyScreen onExit={() => setStudyOpen(false)} />
          </Suspense>
        )}
        {!studyOpen && view.kind === "setup" && (
          <SetupScreen
            inProgress={inProgress}
            starting={starting}
            onStart={startQuiz}
            onResume={resumeQuiz}
            onDiscard={discardInProgress}
            onOpenStudy={() => setStudyOpen(true)}
          />
        )}
        {view.kind === "quiz" && (
          <QuizScreen
            state={view.state}
            onUpdate={updateQuiz}
            onLock={lockAnswer}
            onFinish={finishQuiz}
            onExit={exitToSetup}
          />
        )}
        {view.kind === "results" && (
          <ResultsScreen
            result={view.result}
            examName={examMeta[view.result.config.examId].examName}
            onRestart={restart}
          />
        )}
      </main>

      <footer className="text-center px-6 pb-6">
        <span className="text-xs text-muted-foreground">
          Questions sourced from local markdown files. Progress saved to your browser only.
        </span>
      </footer>
    </div>
  );
}

// Skeleton that mirrors StudyScreen's layout so the lazy boundary doesn't
// cause a layout jump while the chunk loads.
function StudyFallback() {
  return (
    <Card>
      <CardContent className="grid gap-0 p-0 md:grid-cols-[280px_1fr]">
        <aside className="border-b md:border-b-0 md:border-r p-4 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-5 bg-muted animate-pulse" />
          ))}
        </aside>
        <div className="p-6 space-y-3">
          <div className="h-7 w-2/3 bg-muted animate-pulse" />
          <div className="h-4 w-full bg-muted animate-pulse" />
          <div className="h-4 w-5/6 bg-muted animate-pulse" />
          <div className="h-4 w-3/4 bg-muted animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}
