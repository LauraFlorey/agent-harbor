// Chips for what is attached to the next message, plus the window-wide
// file drop that creates them. A long paste collapses into a card of its
// first lines instead of flooding the composer; a file dropped anywhere
// on the window attaches by path.
import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardPaste, File as FileIcon, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  formatSize,
  pasteSummary,
  type Attachment,
} from "@/lib/composer-attachments";

import { uploadFile, UPLOAD_ACCEPT } from "@/lib/uploads";

export function ComposerAttachments({
  items,
  threadId,
  onBusy,
  onAdd,
  onRemove,
}: {
  items: Attachment[];
  threadId: string;
  onBusy: (busy: boolean) => void;
  onAdd: (attachments: Attachment[]) => void;
  onRemove: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // dragenter/dragleave fire once per element crossed, so the overlay
  // tracks depth rather than the last event it happened to see
  const depth = useRef(0);
  const uploadAbort = useRef<AbortController | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  useEffect(() => () => uploadAbort.current?.abort(), []);
  const addFiles = useCallback(async (files: File[]) => {
    if (uploadAbort.current) return;
    const controller = new AbortController();
    uploadAbort.current = controller;
    onBusy(true);
    setNotice(null);
    const failures: string[] = [];
    try {
      for (const file of files.slice(0, Math.max(0, 12 - items.length))) {
        if (controller.signal.aborted) break;
        setPreparing(file.name);
        try { const attachment = await uploadFile(file, threadId, controller.signal); if (!controller.signal.aborted) onAdd([attachment]); }
        catch (error) { if (!controller.signal.aborted) failures.push(`${file.name}: ${error instanceof Error ? error.message : "Could not read file"}`); }
      }
      if (files.length + items.length > 12) failures.push("Attach up to 12 files per message.");
      if (!controller.signal.aborted) setNotice(failures.join(" ") || null);
    } finally { uploadAbort.current = null; if (!controller.signal.aborted) { setPreparing(null); onBusy(false); } }
  }, [threadId, items.length, onAdd, onBusy]);

  useEffect(() => {
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    // without preventDefault the window navigates to the dropped file and
    // the app is simply gone
    const onOver = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      await addFiles(files);
    };

    const onPaste = (event: ClipboardEvent) => { const files = Array.from(event.clipboardData?.files ?? []); if (files.length) { event.preventDefault(); void addFiles(files); } };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [addFiles]);

  return (
    <>
      {dragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-10">
          <div className="rounded-2xl border-2 border-dashed border-accent/70 bg-panel/90 px-8 py-6 text-[14px] font-medium text-ink shadow-2xl">
            Drop files to attach them to this conversation
          </div>
        </div>
      )}

      <div className="mb-2 flex items-center gap-2 text-[12px] text-ink-secondary">
        <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-raised focus-within:ring-2 focus-within:ring-accent">
          <Paperclip size={15} /> Attach files
          <input type="file" multiple accept={UPLOAD_ACCEPT} aria-label="Attach files" disabled={Boolean(preparing)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void addFiles(files); }} />
        </label>
        <span role="status">{preparing ? `Preparing ${preparing}…` : "Documents, images, audio & video"}</span>
      </div>
      {notice && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          <span className="min-w-0 flex-1">{notice}</span>
          <button
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {items.map((a) =>
            a.kind === "paste" ? (
              <Chip
                key={a.id}
                label="PASTED"
                title={a.text.slice(0, 4000)}
                onRemove={() => onRemove(a.id)}
              >
                <div className="relative h-[76px] overflow-hidden">
                  <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.45] text-ink-secondary">
                    {a.text.slice(0, 400)}
                  </pre>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-transparent to-raised" />
                </div>
                <div className="mt-1 text-[10.5px] text-ink-secondary/70">{pasteSummary(a)}</div>
              </Chip>
            ) : (
              <Chip key={a.id} label="FILE" title={a.kind === "upload" ? `${a.name}. ${a.notes}` : a.path} onRemove={() => onRemove(a.id)}>
                <div className="flex h-[76px] items-center gap-2">
                  <FileIcon size={16} className="shrink-0 text-ink-secondary" />
                  <div className="min-w-0">
                    <div className="truncate text-[12px] text-ink">{a.name}</div>
                    <div className="text-[10.5px] text-ink-secondary/70">{formatSize(a.size)}</div>
                  </div>
                </div>
              </Chip>
            ),
          )}
        </div>
      )}
    </>
  );
}

function Chip({
  children,
  label,
  title,
  onRemove,
}: {
  children: React.ReactNode;
  label: "PASTED" | "FILE";
  title: string;
  onRemove: () => void;
}) {
  const Icon = label === "PASTED" ? ClipboardPaste : FileIcon;
  return (
    <div
      title={title}
      className={cn(
        "group relative w-[172px] rounded-xl border border-hairline/40 bg-raised px-2.5 py-2",
        "transition-colors hover:border-hairline",
      )}
    >
      {children}
      <div className="mt-1 flex items-center gap-1">
        <Icon size={11} className="text-ink-secondary/70" />
        <span className="rounded border border-hairline/60 px-1 py-px text-[9.5px] font-medium tracking-wide text-ink-secondary">
          {label}
        </span>
      </div>
      {/* hover reveals it, but so must focus: `hidden` would take the only
          way to drop a chip out of reach of the keyboard */}
      <button
        onClick={onRemove}
        aria-label={`Remove ${label === "PASTED" ? "pasted text" : "file"}`}
        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-hairline/60 bg-panel text-ink-secondary opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X size={11} />
      </button>
    </div>
  );
}
