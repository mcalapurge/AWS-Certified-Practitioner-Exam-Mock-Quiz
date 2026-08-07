import { useCallback, useEffect, useState } from "react";
import type { Provider } from "@/features/quiz/types";
import { PROVIDER_LABEL, loadProvider, saveProvider } from "@/lib/provider";

// Drives the AWS/Claude theme+content switch: persists the choice, toggles a
// `theme-claude` class on <html> for index.css to key off, and updates the
// document title so the browser tab reflects whichever "app" is active.
export function useProvider() {
  const [provider, setProviderState] = useState<Provider>(() => loadProvider());

  useEffect(() => {
    document.documentElement.classList.toggle("theme-claude", provider === "claude");
    document.title = `${PROVIDER_LABEL[provider]} Exam Practice`;
  }, [provider]);

  const setProvider = useCallback((next: Provider) => {
    saveProvider(next);
    setProviderState(next);
  }, []);

  return { provider, setProvider };
}
