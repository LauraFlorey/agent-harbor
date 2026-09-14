import { Paperclip } from "lucide-react";

const reference = /<harbor-attachment id="([a-f0-9-]{36})" name="([^"]*)"\s*\/>/g;
export function withoutAttachmentReferences(text: string) { return text.replace(reference, "").trim(); }
function decodeName(text: string) {
  return text.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(?:9|10|13);/g, " ").replace(/&amp;/g, "&");
}
export function MessageAttachments({ text, threadId }: { text: string; threadId: string }) {
  const files = [...text.matchAll(reference)];
  if (!files.length) return null;
  return <div className="mb-2 flex flex-wrap gap-2">{files.map(([_, id, name]) =>
    <a key={id} download href={`/api/attachments/${id}/download?threadId=${encodeURIComponent(threadId)}`}
      title="Download your saved original" className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-hairline/40 bg-panel/60 px-2.5 py-2 text-[12px] text-ink hover:bg-raised">
      <Paperclip size={14} className="shrink-0" /><span className="truncate">{decodeName(name)}</span>
    </a>)}</div>;
}
