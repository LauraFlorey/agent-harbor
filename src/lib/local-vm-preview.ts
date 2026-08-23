export const LOCAL_VM_PREVIEW_POLL_MS = 3_000;

/** An observation event changes this token immediately; the computer panel
 * also keeps its fixed polling fallback for periods without observations. */
export function nextLocalVmPreviewNonce(current: number | undefined): number {
  return (current ?? 0) + 1;
}
