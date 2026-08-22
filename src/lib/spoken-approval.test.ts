import { describe, expect, it } from "vitest";

import { spokenApprovalDecision } from "./spoken-approval.js";

describe("spokenApprovalDecision", () => {
  it("accepts only short, explicit allow decisions", () => {
    for (const phrase of ["yes", "Approve.", "allow", "go ahead", "do it", "please do!"]) {
      expect(spokenApprovalDecision(phrase)).toBe("allow");
    }
  });

  it("accepts short, explicit denials", () => {
    for (const phrase of ["no", "deny", "cancel.", "do not", "don't", "stop", "skip it!"]) {
      expect(spokenApprovalDecision(phrase)).toBe("deny");
    }
  });

  it("does not treat conversational or compound speech as consent", () => {
    for (const phrase of [
      "sure",
      "ok",
      "okay",
      "fine",
      "yeah",
      "yes, but only after you check",
      "approve the copy after Laura reviews it",
    ]) {
      expect(spokenApprovalDecision(phrase)).toBeNull();
    }
  });
});
