// Local onboarding state only. No analytics SDK or network collection.
const GATE_KEY = "omb-email-gate";
export function emailGateDone(): boolean { return Boolean(localStorage.getItem(GATE_KEY)); }
export function setEmailGateDone(status: "submitted" | "skipped"): void { localStorage.setItem(GATE_KEY, status); }
