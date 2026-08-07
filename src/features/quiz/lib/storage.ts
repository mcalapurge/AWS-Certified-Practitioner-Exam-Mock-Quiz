import type { Provider, QuizResult, QuizState } from "../types";

// Namespaced per provider — AWS and Claude act as two independent "copies" of
// the app, so an in-progress quiz or history entry on one side must never be
// clobbered by starting/finishing a quiz on the other.
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

// One-time migration (runs at module load): before the provider switch existed,
// these keys had no suffix and only ever held AWS data. Move any pre-existing
// value under the "aws" namespace so it isn't silently orphaned by the rename.
(function migrateLegacyKeys() {
  for (const base of [KEY_IN_PROGRESS, KEY_HISTORY]) {
    const legacy = safeGet(base);
    if (legacy === null) continue;
    const aws = `${base}:aws`;
    if (safeGet(aws) === null) safeSet(aws, legacy);
    safeRemove(base);
  }
})();

function inProgressKey(provider: Provider): string {
  return `${KEY_IN_PROGRESS}:${provider}`;
}

function historyKey(provider: Provider): string {
  return `${KEY_HISTORY}:${provider}`;
}

export function loadInProgress(provider: Provider): QuizState | null {
  const raw = safeGet(inProgressKey(provider));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QuizState;
  } catch {
    return null;
  }
}

export function saveInProgress(provider: Provider, state: QuizState) {
  safeSet(inProgressKey(provider), JSON.stringify(state));
}

export function clearInProgress(provider: Provider) {
  safeRemove(inProgressKey(provider));
}

export function loadHistory(provider: Provider): QuizResult[] {
  const raw = safeGet(historyKey(provider));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QuizResult[];
  } catch {
    return [];
  }
}

export function appendHistory(provider: Provider, result: QuizResult) {
  const history = loadHistory(provider);
  history.unshift(result);
  safeSet(historyKey(provider), JSON.stringify(history.slice(0, 25)));
}
