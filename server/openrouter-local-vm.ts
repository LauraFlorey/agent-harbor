import type { LocalVmModelCapability } from "./contracts.ts";

export const OPENROUTER_LOCAL_VM_MANIFEST_REVISION = "2026-08-23.1";
export const OPENROUTER_LOCAL_VM_MODEL_ID = "openai/gpt-5.6-terra";

/** Exact IDs only. Catalog metadata can revoke this authority, never add it. */
export const OPENROUTER_LOCAL_VM_VERIFIED_MODELS = Object.freeze([
  OPENROUTER_LOCAL_VM_MODEL_ID,
] as const);

const verified = new Set<string>(OPENROUTER_LOCAL_VM_VERIFIED_MODELS);

function stringSet(value: unknown): Set<string> | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return new Set(value);
}

function ownRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  return value as Record<string, unknown>;
}

/** Derive model-level evidence from one current /models/user record. */
export function openRouterLocalVmModelCapability(
  modelId: string,
  rawRecord: unknown,
): LocalVmModelCapability {
  if (!verified.has(modelId)) {
    return Object.freeze({
      status: "unsupported",
      reason: "This OpenRouter model remains available for text chat but is not verified for Local VM tools.",
    });
  }

  const record = ownRecord(rawRecord);
  const architecture = ownRecord(record?.architecture);
  const input = stringSet(architecture?.input_modalities);
  const output = stringSet(architecture?.output_modalities);
  const parameters = stringSet(record?.supported_parameters);
  if (!record || record.id !== modelId || !input || !output || !parameters) {
    return Object.freeze({
      status: "unknown",
      reason: "Agent Harbor could not verify this model's current Local VM metadata.",
      manifestRevision: OPENROUTER_LOCAL_VM_MANIFEST_REVISION,
    });
  }
  if (!input.has("text") || !input.has("image") || !output.has("text") || !parameters.has("tools")) {
    return Object.freeze({
      status: "unsupported",
      reason: "This model's current metadata does not confirm text, image, and tool support for the Local VM.",
      manifestRevision: OPENROUTER_LOCAL_VM_MANIFEST_REVISION,
    });
  }
  return Object.freeze({
    status: "verified",
    reason: "Verified for the experimental isolated Local VM tool loop.",
    manifestRevision: OPENROUTER_LOCAL_VM_MANIFEST_REVISION,
  });
}

export interface OpenRouterLocalVmTurnEligibilityInput {
  globalEnabled: boolean;
  agentEnabled: boolean;
  directConversation: boolean;
  destination: "cloud" | "vm" | "local" | "off" | undefined;
  selectedModel: string;
  catalogCapability: LocalVmModelCapability | undefined;
}

export interface OpenRouterLocalVmTurnEligibility {
  eligible: boolean;
  reason:
    | "eligible"
    | "feature_disabled"
    | "agent_disabled"
    | "not_direct"
    | "destination_off"
    | "model_not_verified"
    | "metadata_unverified";
}

/** Persisted computer choices stay untouched. An ineligible OpenRouter turn
 * treats every destination as inert text chat; the eligible path is VM-only. */
export function openRouterTurnDestination(
  requested: OpenRouterLocalVmTurnEligibilityInput["destination"],
  eligible: boolean,
): "vm" | "off" {
  return eligible && requested === "vm" ? "vm" : "off";
}

/** Complete non-runtime turn gate. Runtime readiness is checked only after
 * the exclusive lease is held so setup and dispatch cannot race. */
export function openRouterLocalVmTurnEligibility(
  input: OpenRouterLocalVmTurnEligibilityInput,
): OpenRouterLocalVmTurnEligibility {
  if (!input.globalEnabled) return { eligible: false, reason: "feature_disabled" };
  if (!input.agentEnabled) return { eligible: false, reason: "agent_disabled" };
  if (!input.directConversation) return { eligible: false, reason: "not_direct" };
  if (input.destination !== "vm") return { eligible: false, reason: "destination_off" };
  if (input.selectedModel !== OPENROUTER_LOCAL_VM_MODEL_ID || !verified.has(input.selectedModel)) {
    return { eligible: false, reason: "model_not_verified" };
  }
  if (
    input.catalogCapability?.status !== "verified" ||
    input.catalogCapability.manifestRevision !== OPENROUTER_LOCAL_VM_MANIFEST_REVISION
  ) {
    return { eligible: false, reason: "metadata_unverified" };
  }
  return { eligible: true, reason: "eligible" };
}
