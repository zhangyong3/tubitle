import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { expect, it } from "vitest";
import { copyPdfFontAssets } from "../../../scripts/pdf-font-assets.mjs";
import { createTranscriptPdf } from "./transcript-pdf";

function readEmbeddedGlyph(pdf, character) {
  const unicode = character.codePointAt(0).toString(16).padStart(4, "0");
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of("Subtype")) !== PDFName.of("Type0")) continue;
    const cmap = object.lookup(PDFName.of("ToUnicode"), PDFRawStream);
    const mapping = new TextDecoder().decode(decodePDFRawStream(cmap).decode());
    const gid = mapping.match(new RegExp(`<([0-9a-f]+)>\\s*<${unicode}>`, "i"))?.[1];
    if (!gid) continue;
    const descendant = object.lookup(PDFName.of("DescendantFonts")).lookup(0, PDFDict);
    const descriptor = descendant.lookup(PDFName.of("FontDescriptor"), PDFDict);
    const font = descriptor.lookup(PDFName.of("FontFile2"), PDFRawStream);
    return fontkit.create(decodePDFRawStream(font).decode()).getGlyph(parseInt(gid, 16)).path;
  }
  throw new Error(`No embedded glyph for ${character}`);
}

it("embeds visible glyphs for the English subtitle and Chinese translation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tubitle-pdf-test-"));
  try {
    await copyPdfFontAssets(fileURLToPath(new URL("../../", import.meta.url)), directory);
    const pdf = await createTranscriptPdf("Subtitle export", [{
      startMs: 0, text: "Cover your mouth.", translation: "捂住嘴巴。", highlights: [], words: []
    }], async (file) => {
      const bytes = await readFile(join(directory, file));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    });
    const document = await PDFDocument.load(pdf);
    expect(document.getPageCount()).toBe(1);
    for (const character of ["C", "捂"]) {
      const path = readEmbeddedGlyph(document, character);
      expect(path.commands.length, `Missing outline for ${character}`).toBeGreaterThan(8);
      expect(path.bbox.width).toBeGreaterThan(250);
      expect(path.bbox.height).toBeGreaterThan(250);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
