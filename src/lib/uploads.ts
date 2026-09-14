import type { UploadAttachment } from "./composer-attachments";

export const UPLOAD_ACCEPT = ".doc,.docx,.rtf,.xls,.xlsx,.csv,.pdf,.txt,.md,.json,.png,.jpg,.jpeg,.webp,.gif,.mp3,.m4a,.wav,.ogg,.flac,.aac,.mp4,.mov,.webm,.mkv";
export async function uploadFile(file: File, threadId: string, signal: AbortSignal): Promise<UploadAttachment> {
  if (file.size > 100 * 1024 * 1024) throw new Error("Files can be up to 100 MB; documents and images up to 20 MB.");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not open this file."));
    reader.readAsDataURL(file);
  });
  const response = await fetch("/api/attachments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId, name: file.name, data }), signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not attach this file.");
  const a = body.attachment;
  return { kind: "upload", id: a.id, name: a.name, size: a.size, mediaKind: a.kind, notes: a.notes };
}
