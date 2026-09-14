import { parentPort, workerData } from "node:worker_threads";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";

export interface AttachmentSection { label: string; text: string }
const require = createRequire(import.meta.url);
async function pdf(path: string) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const root = dirname(require.resolve("pdfjs-dist/package.json"));
  const task = getDocument({ data: new Uint8Array(await fs.readFile(path)),
    useSystemFonts: true, standardFontDataUrl: join(root, "standard_fonts") + "/", cMapUrl: join(root, "cmaps") + "/", cMapPacked: true });
  return { doc: await task.promise, task };
}
async function run() {
  const { path, extension, action, page } = workerData as { path: string; extension: string; action: string; page?: number };
  if (action === "image") {
    return { image: (await sharp(path, { limitInputPixels: 60_000_000 }).rotate().resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer()).toString("base64") };
  }
  if (extension === ".pdf") {
    const { doc, task } = await pdf(path);
    try {
      if (doc.numPages > 500) throw new Error("This PDF has more than 500 pages. Split it into smaller files.");
      if (action === "page") {
        if (!page || page < 1 || page > doc.numPages) throw new Error("Choose a page in this PDF.");
        const p = await doc.getPage(page);
        const base = p.getViewport({ scale: 1 });
        const viewport = p.getViewport({ scale: Math.min(2, 1400 / Math.max(base.width, base.height)) });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await p.render({ canvas: canvas as never, canvasContext: canvas.getContext("2d") as never, viewport }).promise;
        return { image: canvas.toBuffer("image/jpeg", 75).toString("base64") };
      }
      const sections: AttachmentSection[] = [];
      let total = 0;
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const content = await p.getTextContent();
        const text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
        total += text.length;
        if (total > 2_000_000) throw new Error("This PDF contains too much text. Split it into smaller files.");
        sections.push({ label: `Page ${i}`, text: text.trim() || "[No embedded text. Read this page as an image to inspect a scan.]" });
        p.cleanup();
      }
      return { sections, pages: doc.numPages, notes: "PDF text extraction may omit layout or chart details. Page images are available for visual inspection." };
    } finally { await task.destroy(); }
  }
  if ([".xls", ".xlsx", ".csv"].includes(extension)) {
    const workbook = XLSX.read(await fs.readFile(path), { type: "buffer", cellFormula: true, cellDates: true, cellHTML: false, bookVBA: false });
    const sections: AttachmentSection[] = [];
    let cells = 0, chars = 0;
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      let lines: string[] = [];
      const push = () => { if (lines.length) sections.push({ label: `Sheet ${name}, cells ${lines[0].split(" ")[0]}–${lines.at(-1)!.split(" ")[0]}`, text: lines.join("\n") }); lines = []; };
      for (const key of Object.keys(sheet).filter(k => /^[A-Z]+[1-9][0-9]*$/.test(k))) {
        if (++cells > 100_000) throw new Error("This spreadsheet exceeds 100,000 populated cells. Upload the relevant sheets or a smaller export.");
        const cell = sheet[key];
        const line = `${key} ${JSON.stringify(cell.w ?? cell.v ?? "")}${cell.f ? ` [formula: =${cell.f}; cached value: ${JSON.stringify(cell.v ?? null)}]` : ""}`;
        chars += line.length;
        if (chars > 2_000_000) throw new Error("This spreadsheet is too large to index. Upload a smaller export.");
        lines.push(line);
        if (lines.length >= 400) push();
      }
      push();
      if (!Object.keys(sheet).some(k => /^[A-Z]+[1-9]/.test(k))) sections.push({ label: `Sheet ${name}`, text: "[Empty sheet]" });
    }
    return { sections, notes: "Cell addresses, displayed values, and formulas are included. Formulas are not recalculated; cached values may be stale. Charts and embedded images are not extracted." };
  }
  let text: string, notes = "";
  if (extension === ".docx") {
    const result = await mammoth.convertToHtml({ path }, { externalFileAccess: false, convertImage: mammoth.images.imgElement(async () => ({ src: "" })) });
    text = result.value.replace(/<\/t[dh]>/g, "\t").replace(/<\/(?:p|tr|h[1-6]|li|table)>/g, "\n").replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    notes = "Document text and table cells extracted. Embedded images, exact page layout, and tracked-change history are not interpreted.";
  } else if ([".doc", ".rtf"].includes(extension)) {
    if (process.platform !== "darwin") throw new Error("Please save this document as DOCX first.");
    text = (await promisify(execFile)("/usr/bin/textutil", ["-convert", "txt", "-stdout", path], { timeout: 30_000, maxBuffer: 2_000_000 })).stdout;
    notes = "Document text extracted locally. Formatting and embedded images are not interpreted.";
  } else {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await fs.readFile(path));
  }
  if (text.length > 2_000_000) throw new Error("This document is too long. Upload a smaller excerpt.");
  const sections: AttachmentSection[] = [];
  for (let i = 0; i < text.length; i += 16_000) sections.push({ label: `Text part ${sections.length + 1}`, text: text.slice(i, i + 16_000) });
  return { sections: sections.length ? sections : [{ label: "Document", text: "[No readable text found]" }], notes };
}
run().then(result => parentPort!.postMessage({ result }), error => parentPort!.postMessage({ error: error instanceof Error ? error.message : "Could not read file" }));
