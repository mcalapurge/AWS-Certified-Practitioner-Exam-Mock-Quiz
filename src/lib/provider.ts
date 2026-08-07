import type { Provider } from "@/features/quiz/types";

const KEY_PROVIDER = "examprep:v1:provider";

export const PROVIDER_LABEL: Record<Provider, string> = {
  aws: "AWS",
  claude: "Claude",
};

export function loadProvider(): Provider {
  try {
    const raw = window.localStorage.getItem(KEY_PROVIDER);
    return raw === "claude" ? "claude" : "aws";
  } catch {
    return "aws";
  }
}

export function saveProvider(provider: Provider) {
  try {
    window.localStorage.setItem(KEY_PROVIDER, provider);
  } catch {
    /* ignore */
  }
}
