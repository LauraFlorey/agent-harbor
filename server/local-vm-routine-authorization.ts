/** Turn-local policy derived only from owner-controlled application state.
 * It never carries approval capabilities and cannot authorize consequential
 * actions. Create a fresh instance for every Local VM turn. */
export class LocalVmRoutineAuthorization {
  private granted = false;
  private readonly autoMode: boolean;

  constructor(autoMode: boolean) {
    this.autoMode = autoMode;
  }

  shouldAuthorize(consequential: boolean, unattended: boolean): boolean {
    if (consequential) return false;
    if (this.granted) return true;
    if (!this.autoMode || unattended) return false;
    this.granted = true;
    return true;
  }

  recordHumanDecision(consequential: boolean, behavior: "allow" | "deny"): void {
    if (!consequential && behavior === "allow") this.granted = true;
  }
}
