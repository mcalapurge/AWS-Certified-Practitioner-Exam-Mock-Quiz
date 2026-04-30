import type { QuizResult, QuizState } from "../types";

const KEY_IN_PROGRESS = "examprep:v1:in-progress";
const KEY_HISTORY = "examprep:v1:history";

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function safeRemove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadInProgress(): QuizState | null {
  const raw = safeGet(KEY_IN_PROGRESS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QuizState;
  } catch {
    return null;
  }
}

export function saveInProgress(state: QuizState) {
  safeSet(KEY_IN_PROGRESS, JSON.stringify(state));
}

export function clearInProgress() {
  safeRemove(KEY_IN_PROGRESS);
}

export function loadHistory(): QuizResult[] {
  const raw = safeGet(KEY_HISTORY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QuizResult[];
  } catch {
    return [];
  }
}

export function appendHistory(result: QuizResult) {
  const history = loadHistory();
  history.unshift(result);
  safeSet(KEY_HISTORY, JSON.stringify(history.slice(0, 25)));
}
