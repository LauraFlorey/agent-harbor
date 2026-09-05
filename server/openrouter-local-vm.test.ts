import { describe, expect, it } from "vitest";

import {
  OPENROUTER_LOCAL_VM_MANIFEST_REVISION,
  OPENROUTER_LOCAL_VM_MODEL_ID,
  OPENROUTER_LOCAL_VM_VERIFIED_MODELS,
  openRouterLocalVmModelCapability,
  openRouterLocalVmTurnEligibility,
  openRouterTurnDestination,
} from "./openrouter-local-vm.ts";

const terraMetadata = {
  id: OPENROUTER_LOCAL_VM_MODEL_ID,
  architecture: {
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
  },
  supported_parameters: ["tools", "temperature"],
};

describe("OpenRouter Local VM exact model eligibility", () => {
  it("keeps a revisioned exact Terra-only manifest", () => {
    expect(OPENROUTER_LOCAL_VM_MANIFEST_REVISION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(OPENROUTER_LOCAL_VM_VERIFIED_MODELS).toEqual(["openai/gpt-5.6-terra"]);
  });

  it("verifies Terra only when current metadata confirms text, image, output text, and tools", () => {
    expect(openRouterLocalVmModelCapability(OPENROUTER_LOCAL_VM_MODEL_ID, terraMetadata)).toMatchObject({
      status: "verified",
      manifestRevision: OPENROUTER_LOCAL_VM_MANIFEST_REVISION,
    });
    for (const record of [
      { ...terraMetadata, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
      { ...terraMetadata, architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] } },
      { ...terraMetadata, supported_parameters: ["temperature"] },
      { ...terraMetadata, supported_parameters: "tools" },
      { ...terraMetadata, id: "openai/gpt-5.6-terra:alias" },
      null,
    ]) {
      expect(openRouterLocalVmModelCapability(OPENROUTER_LOCAL_VM_MODEL_ID, record).status).not.toBe("verified");
    }
  });

  it("never grants aliases, routers, wildcards, fallbacks, partial IDs, or metadata-only models", () => {
    for (const id of [
      "openrouter/auto",
      "openai/gpt-5.6-terra:free",
      "openai/gpt-5.6-terra/latest",
      "openai/gpt-5.6-*",
      "openai/gpt-5.6",
      "vendor/router",
      "openai/gpt-5.6-terra-fallback",
      "vendor/function-caller",
    ]) {
      expect(openRouterLocalVmModelCapability(id, { ...terraMetadata, id }).status).toBe("unsupported");
    }
  });

  it("requires every feature, agent, direct-conversation, destination, ID, and metadata condition", () => {
    const capability = openRouterLocalVmModelCapability(OPENROUTER_LOCAL_VM_MODEL_ID, terraMetadata);
    const valid = {
      globalEnabled: true,
      agentEnabled: true,
      directConversation: true,
      destination: "vm" as const,
      selectedModel: OPENROUTER_LOCAL_VM_MODEL_ID,
      catalogCapability: capability,
    };
    expect(openRouterLocalVmTurnEligibility(valid)).toEqual({ eligible: true, reason: "eligible" });
    expect(openRouterLocalVmTurnEligibility({ ...valid, globalEnabled: false }).eligible).toBe(false);
    expect(openRouterLocalVmTurnEligibility({ ...valid, agentEnabled: false }).eligible).toBe(false);
    expect(openRouterLocalVmTurnEligibility({ ...valid, directConversation: false }).eligible).toBe(false);
    expect(openRouterLocalVmTurnEligibility({ ...valid, destination: "off" }).eligible).toBe(false);
    expect(openRouterLocalVmTurnEligibility({ ...valid, selectedModel: "openrouter/auto" }).eligible).toBe(false);
    expect(openRouterLocalVmTurnEligibility({ ...valid, catalogCapability: undefined }).eligible).toBe(false);
    expect(openRouterLocalVmTurnEligibility({
      ...valid,
      catalogCapability: { ...capability, manifestRevision: "stale-revision" },
    }).eligible).toBe(false);
  });

  it("keeps ineligible saved destinations inert for text and never substitutes host or cloud", () => {
    for (const destination of ["off", "vm", "local", "cloud"] as const) {
      expect(openRouterTurnDestination(destination, false)).toBe("off");
    }
    expect(openRouterTurnDestination("vm", true)).toBe("vm");
    expect(openRouterTurnDestination("local", true)).toBe("off");
    expect(openRouterTurnDestination("cloud", true)).toBe("off");
  });
});
