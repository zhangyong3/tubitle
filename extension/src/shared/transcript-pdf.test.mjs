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

function extractPageText(document, page) {
  const fonts = page.node.Resources().lookup(PDFName.of("Font"), PDFDict);
  const maps = new Map();
  for (const [name, ref] of fonts.entries()) {
    const font = document.context.lookup(ref, PDFDict);
    const cmap = new TextDecoder().decode(decodePDFRawStream(font.lookup(PDFName.of("ToUnicode"), PDFRawStream)).decode());
    maps.set(name.toString().slice(1), new Map([...cmap.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)].map(([, gid, unicode]) => [
      parseInt(gid, 16), String.fromCharCode(...(unicode.match(/.{4}/g) || []).map((unit) => parseInt(unit, 16)))
    ])));
  }
  const contents = page.node.Contents();
  let text = "";
  let current;
  for (let i = 0; i < contents.size(); i++) {
    const stream = new TextDecoder().decode(decodePDFRawStream(contents.lookup(i, PDFRawStream)).decode());
    for (const match of stream.matchAll(/\/([^\s]+)\s+[\d.]+\s+Tf|<([0-9a-f]+)>\s*Tj/gi)) {
      if (match[1]) current = maps.get(match[1]);
      else for (const gid of match[2].match(/.{4}/g)) text += current?.get(parseInt(gid, 16)) ?? "?";
    }
  }
  return text;
}

import { afterAll, beforeAll, describe, vi } from "vitest";
import { UI_LANGUAGES, getUiLanguage, setUiLanguage, translateForLanguage } from "./i18n";
import { DEFAULT_SETTINGS } from "./settings";
import { downloadTranscriptPdf } from "./transcript-pdf";

describe("localized PDF exports", () => {
  let directory;
  let readAsset;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "tubitle-pdf-locales-"));
    await copyPdfFontAssets(fileURLToPath(new URL("../../", import.meta.url)), directory);
    readAsset = async (file) => {
      const bytes = await readFile(join(directory, file));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    };
  });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  for (const [language] of UI_LANGUAGES) {
    it(`uses ${language} target language with visible local fonts and a header logo`, async () => {
      setUiLanguage(language === "fr" ? "ja" : "fr");
      const interfaceLanguage = getUiLanguage();
      const bytes = await createTranscriptPdf("Export sample", [{
        startMs: 4000, text: "Learn one sentence at a time.", translation: translateForLanguage(language, "学习旁批"),
        highlights: [], words: []
      }], readAsset, language);
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.catalog.lookup(PDFName.of("Lang")).decodeText()).toBe(language);
      expect(getUiLanguage()).toBe(interfaceLanguage);
      const text = extractPageText(pdf, pdf.getPage(0));
      expect(text).not.toContain("?");
      if (!["ar", "th"].includes(language)) {
        expect(text).toContain(translateForLanguage(language, "字幕学习笔记"));
        expect(text).toContain(translateForLanguage(language, "英文字幕"));
        expect(text).toContain(translateForLanguage(language, "学习旁批"));
      }
      const images = pdf.getPage(0).node.Resources().lookup(PDFName.of("XObject"), PDFDict);
      expect(images.entries().some(([, ref]) => {
        const image = pdf.context.lookup(ref, PDFRawStream);
        return image.dict.get(PDFName.of("Subtype")) === PDFName.of("Image") && image.dict.lookup(PDFName.of("Width")).asNumber() === 128;
      })).toBe(true);
    });
  }

  it("keeps Arabic joining glyphs and their actual widths in the embedded font", async () => {
    const bytes = await createTranscriptPdf("Arabic sample", [{ startMs: 0, text: "Hello.", translation: "ملاحظات التعلم", highlights: [], words: [] }], readAsset, "ar");
    const pdf = await PDFDocument.load(bytes);
    let checked = false;
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict) || object.get(PDFName.of("Subtype")) !== PDFName.of("Type0")) continue;
      if (!object.get(PDFName.of("BaseFont")).toString().includes("Arabic")) continue;
      const descendant = object.lookup(PDFName.of("DescendantFonts")).lookup(0, PDFDict);
      const fontStream = descendant.lookup(PDFName.of("FontDescriptor"), PDFDict).lookup(PDFName.of("FontFile2"), PDFRawStream);
      const font = fontkit.create(decodePDFRawStream(fontStream).decode());
      if (!font.hasGlyphForCodePoint("م".codePointAt(0))) continue;
      const widths = descendant.lookup(PDFName.of("W"));
      const values = new Map();
      for (let i = 0; i < widths.size(); i += 2) {
        const start = widths.lookup(i).asNumber();
        const list = widths.lookup(i + 1);
        for (let j = 0; j < list.size(); j++) values.set(start + j, list.lookup(j).asNumber());
      }
      for (const glyph of font.layout("ملاحظات").glyphs) {
        expect(values.get(glyph.id), `Missing shaped width for Arabic glyph ${glyph.id}`).toBeCloseTo(glyph.advanceWidth * 1000 / font.unitsPerEm, 3);
        expect(glyph.path.commands.length).toBeGreaterThan(0);
      }
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it("repeats the logo on later pages and localizes the copyright section", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({
      startMs: index * 3000, text: "Learn one sentence at a time.", translation: "Ein Satz nach dem anderen.", highlights: [],
      words: index === 0 ? [{ word: "learn", senses: [{ partOfSpeech: "v", definitions: ["gain knowledge"], examples: [] }] }] : []
    }));
    const pdf = await PDFDocument.load(await createTranscriptPdf("Study notes", rows, readAsset, "de"));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    for (const page of pdf.getPages()) {
      expect(page.node.Resources().lookup(PDFName.of("XObject"), PDFDict).entries().length).toBeGreaterThan(0);
      expect(extractPageText(pdf, page)).toContain("Lernnotizen zu Untertiteln");
    }
    expect(pdf.getPages().map((page) => extractPageText(pdf, page)).join("\n")).toContain("Definitionsquellen und Urheberrecht");
  });

  it("downloads with the configured target language and the uniform product filename", async () => {
    const link = { click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("chrome", { runtime: { getURL: (path) => path }, storage: { local: { get: async () => ({ settings: { ...DEFAULT_SETTINGS, uiLanguage: "fr", targetLanguage: "ja" } }) } } });
    vi.stubGlobal("fetch", async (path) => ({ ok: true, arrayBuffer: () => readAsset(path.replace("pdf-fonts/", "")) }));
    vi.stubGlobal("document", { createElement: () => link, body: { append: vi.fn() } });
    vi.stubGlobal("window", { setTimeout: vi.fn() });
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pdf-test");
    try {
      await downloadTranscriptPdf("Video: sample", [{ startMs: 0, text: "Hello.", highlights: [], words: [] }]);
      expect(link.download).toBe("Video_ sample - tubitle.pdf");
      expect(link.click).toHaveBeenCalledOnce();
      const pdf = await PDFDocument.load(await createUrl.mock.calls[0][0].arrayBuffer());
      expect(pdf.catalog.lookup(PDFName.of("Lang")).decodeText()).toBe("ja");
      expect(extractPageText(pdf, pdf.getPage(0))).toContain("字幕学習ノート");
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
