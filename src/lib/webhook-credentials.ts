import type { WebhookCredential } from "./webhooks.js";

const KEY = "omb-webhook-credentials";

type Store = Pick<Storage, "getItem" | "setItem"> | undefined;

const volatileValues = new Map<string, string>();
const volatileStore: Store = {
  getItem: (key) => volatileValues.get(key) ?? null,
  setItem: (key, value) => void volatileValues.set(key, value),
};

function isCredential(value: unknown): value is WebhookCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return [candidate.endpointUrl, candidate.secret, candidate.url].every(
    (part) => typeof part === "string" && part.length > 0,
  );
}

/** Private webhook URLs are returned only when created or rotated. They remain
 * available across panel remounts, but never persist in renderer storage. */
export function loadWebhookCredentials(store: Store): Record<string, WebhookCredential> {
  try {
    const raw = store?.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, WebhookCredential] => isCredential(entry[1])),
    );
  } catch {
    return {};
  }
}

export function saveWebhookCredential(store: Store, webhookId: string, credential: WebhookCredential): void {
  const credentials = loadWebhookCredentials(store);
  credentials[webhookId] = credential;
  try {
    store?.setItem(KEY, JSON.stringify(credentials));
  } catch {
    // Storage is best-effort. The URL remains usable for this mount.
  }
}

export function removeWebhookCredential(store: Store, webhookId: string): void {
  const credentials = loadWebhookCredentials(store);
  delete credentials[webhookId];
  try {
    store?.setItem(KEY, JSON.stringify(credentials));
  } catch {
    // A failed cleanup must not block deleting the webhook itself.
  }
}

export function webhookCredentialStore(): Store {
  return volatileStore;
}
