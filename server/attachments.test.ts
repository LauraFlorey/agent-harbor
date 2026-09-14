import { describe, it, expect, vi } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";
import * as XLSX from "xlsx";
import sharp from "sharp";
import { saveAttachment, loadAttachment, attachmentTools, attachmentContext, attachmentIds, ATTACHMENTS_DIR } from "./attachments.ts";
import * as mediaHelpers from "./attachment-media.ts";
import { DATA_DIR } from "./config.ts";

const signal = () => new AbortController().signal;
describe("readable attachments", () => {
  it("keeps original bytes and scopes reads to their conversation and branch", async () => {
    const bytes = Buffer.from("A small note: amber lantern.");
    const a = await saveAttachment("one", "notes.txt", bytes);
    expect(await fs.readFile(join(ATTACHMENTS_DIR, a.id, "original.txt"))).toEqual(bytes);
    await expect(loadAttachment(a.id, "two")).rejects.toThrow("another conversation");
    await expect(attachmentTools("one", [])[0].execute({ id: a.id, action: "text" }, signal())).rejects.toThrow("active conversation branch");
    expect(await attachmentTools("one", [a.id])[0].execute({ id: a.id, action: "text" }, signal())).toMatchObject({ text: bytes.toString() });
    expect(attachmentIds(`<harbor-attachment id="${a.id}" name="notes.txt" />`)).toEqual([a.id]);
  });
  it("reads DOCX tables without following document external references", async () => {
    const bytes = Buffer.from(zipSync({
      "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      "word/document.xml": strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Harbor document test</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Amber</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>27</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'),
    }));
    const a = await saveAttachment("docs", "brief.docx", bytes);
    expect(a.sections[0].text).toContain("Harbor document test");
    expect(a.sections[0].text).toContain("Amber");
    expect(a.sections[0].text).toContain("27");
  });
  it.each(["xlsx", "xls"] as const)("reads %s sheet names, values, and formulas", async type => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Qty", "Price", "Total"], [3, 7, 21]]);
    sheet.C2.f = "A2*B2";
    XLSX.utils.book_append_sheet(book, sheet, "Order");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Second sheet", 44]]), "Summary");
    const a = await saveAttachment("sheets", `test.${type}`, XLSX.write(book, { type: "buffer", bookType: type }));
    expect(a.sections.map(s => s.label).join(" ")).toContain("Summary");
    expect(a.sections[0].text).toContain('A2 "3"');
    if (type === "xlsx") expect(a.sections[0].text).toContain("formula: =A2*B2");
    expect(a.notes).toContain("not recalculated");
  });
  it("reads PDF text and renders scan pages for vision", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([300, 220]).drawText("Amber invoice 427", { x: 20, y: 100, font, size: 18 });
    const png = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#20aa44" } }).png().toBuffer();
    const image = await doc.embedPng(png);
    doc.addPage([300, 220]).drawImage(image, { x: 0, y: 0, width: 240, height: 160 });
    const a = await saveAttachment("pdf", "invoice.pdf", Buffer.from(await doc.save()));
    expect(a.sections[0].text).toContain("Amber invoice 427");
    expect(a.sections[1].text).toContain("No embedded text");
    const result = await attachmentTools("pdf", [a.id])[0].execute({ id: a.id, action: "image", page: 2 }, signal()) as { content: Array<{ type: string; data?: string }> };
    expect(result.content[1].type).toBe("image");
    expect((await sharp(Buffer.from(result.content[1].data!, "base64")).metadata()).width).toBeGreaterThan(0);
  });
  it.each(["png", "jpg"])("provides real %s pixels and keeps text-only local mode private", async extension => {
    const input = sharp({ create: { width: 80, height: 60, channels: 3, background: "#aa1144" } });
    const bytes = extension === "png" ? await input.png().toBuffer() : await input.jpeg().toBuffer();
    const a = await saveAttachment("images", `picture.${extension}`, bytes);
    const result = await attachmentTools("images", [a.id])[0].execute({ id: a.id, action: "image" }, signal()) as { content: Array<{ type: string }> };
    expect(result.content[1].type).toBe("image");
    await expect(attachmentTools("images", [a.id], true)[0].execute({ id: a.id, action: "image" }, signal())).rejects.toThrow("No cloud model was contacted");
  });
  it("rejects unsupported, empty and damaged files and symlinked copy folders", async () => {
    await expect(saveAttachment("x", "script.exe", Buffer.from("bad"))).rejects.toThrow("Choose a document");
    await expect(saveAttachment("x", "empty.pdf", Buffer.alloc(0))).rejects.toThrow("non-empty");
    await expect(saveAttachment("x", "broken.png", Buffer.from("not an image"))).rejects.toThrow();
    const a = await saveAttachment("x", "valid.txt", Buffer.from("only this text"));
    const workspace = join(DATA_DIR, "test-work"), outside = join(DATA_DIR, "outside");
    await fs.mkdir(workspace, { recursive: true }); await fs.mkdir(outside);
    await fs.symlink(outside, join(workspace, ".harbor-attachments"));
    await expect(attachmentContext("x", [a.id], workspace)).rejects.toThrow("symbolic link");
    expect(await fs.readdir(outside)).toEqual([]);
  });
  it("prepares opening speech locally and clearly labels untranscribed remainder", async () => {
    const info = vi.spyOn(mediaHelpers, "mediaInfo").mockResolvedValue({ duration: 900, audio: true, video: true });
    const transcribe = vi.spyOn(mediaHelpers, "transcribeMedia").mockResolvedValue("Friday at three. Seven blue folders.");
    try {
      const a = await saveAttachment("media", "meeting.mp4", Buffer.from("test-media"));
      expect(transcribe.mock.calls[0].slice(2, 4)).toEqual([0, 600]);
      expect(a.sections[0].label).toContain("600.0 seconds of 900.0");
      expect(a.sections[0].text).toContain("Seven blue folders");
      expect(a.notes).toContain("request later segments");
    } finally { info.mockRestore(); transcribe.mockRestore(); }
  });
  it("keeps missing transcription explicit instead of calling unavailable audio silent", async () => {
    const info = vi.spyOn(mediaHelpers, "mediaInfo").mockResolvedValue({ duration: 12, audio: true, video: false });
    const transcribe = vi.spyOn(mediaHelpers, "transcribeMedia").mockRejectedValue(new Error("Whisper is unavailable"));
    try {
      const a = await saveAttachment("media", "meeting.mp3", Buffer.from("test-media"));
      expect(a.sections).toEqual([]);
      expect(a.notes).toContain("Transcription is not available yet");
    } finally { info.mockRestore(); transcribe.mockRestore(); }
  });

});
