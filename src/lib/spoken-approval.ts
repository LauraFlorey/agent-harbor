export type SpokenApprovalDecision = "allow" | "deny" | null;

// Speech recognition can add terminal punctuation, but consent still needs to
// be a short, explicit answer. Conversational fillers such as "sure", "ok",
// and "fine" are intentionally not permission decisions.
const ALLOW = /^(yes|approve|approved|allow|go ahead|do it|please do)[.!?]?$/i;
const DENY = /^(no|deny|denied|cancel|do not|don't|stop|never|skip it)[.!?]?$/i;

export function spokenApprovalDecision(transcript: string): SpokenApprovalDecision {
  const said = transcript.trim();
  if (ALLOW.test(said)) return "allow";
  if (DENY.test(said)) return "deny";
  return null;
}
