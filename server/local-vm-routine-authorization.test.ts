import { describe, expect, it } from "vitest";

import { LocalVmRoutineAuthorization } from "./local-vm-routine-authorization.ts";

describe("Local VM task authorization", () => {
  it("turns one human routine approval into a grant for that turn only", () => {
    const firstTurn = new LocalVmRoutineAuthorization(false);
    expect(firstTurn.shouldAuthorize(false, false)).toBe(false);
    firstTurn.recordHumanDecision(false, "allow");
    expect(firstTurn.shouldAuthorize(false, false)).toBe(true);
    expect(firstTurn.shouldAuthorize(true, false)).toBe(false);

    const nextTurn = new LocalVmRoutineAuthorization(false);
    expect(nextTurn.shouldAuthorize(false, false)).toBe(false);
  });

  it("honors owner-enabled Auto mode only for attended routine actions", () => {
    expect(new LocalVmRoutineAuthorization(true).shouldAuthorize(false, false)).toBe(true);
    expect(new LocalVmRoutineAuthorization(true).shouldAuthorize(false, true)).toBe(false);
    expect(new LocalVmRoutineAuthorization(true).shouldAuthorize(true, false)).toBe(false);
  });

  it("does not grant a session after denial or a consequential approval", () => {
    const denied = new LocalVmRoutineAuthorization(false);
    denied.recordHumanDecision(false, "deny");
    expect(denied.shouldAuthorize(false, false)).toBe(false);

    const consequential = new LocalVmRoutineAuthorization(false);
    consequential.recordHumanDecision(true, "allow");
    expect(consequential.shouldAuthorize(false, false)).toBe(false);
  });
});
