import { describe, expect, it } from "vitest";

import { LOCAL_VM_PREVIEW_POLL_MS, nextLocalVmPreviewNonce } from "./local-vm-preview";

describe("Local VM product preview refresh", () => {
  it("changes the immediate refresh token for every tool observation", () => {
    expect(nextLocalVmPreviewNonce(undefined)).toBe(1);
    expect(nextLocalVmPreviewNonce(1)).toBe(2);
  });

  it("retains the existing three-second polling fallback", () => {
    expect(LOCAL_VM_PREVIEW_POLL_MS).toBe(3_000);
  });
});
