import bidiFactory from "bidi-js";
import { translateForLanguage } from "./i18n";
import { resolveUiLanguage } from "./ui-language";
import { getSettings } from "./settings";
import fontkit from "@pdf-lib/fontkit";
import { Cache, CustomFontEmbedder, degrees, PDFDocument, PDFFont, type PDFPage, rgb } from "pdf-lib";
import { formatCaptionTime, type TranscriptNoteRow } from "./transcript-notes";
import { PRINCETON_LICENSE, PRINCETON_NOTICE, WORDNET_COPYRIGHT, WORDNET_LICENSE, WORDNET_NAME, WORDNET_SITE } from "./wordnet";

interface FontFace { file: string; ranges: string; family?: string }
interface TextPart { text: string; highlight?: boolean }
interface Run extends TextPart { font: PDFFont; width: number }
interface NoteParagraph { text: string; kind?: "heading" | "example" }
interface NoteSection { paragraphs: NoteParagraph[]; wordKey?: string }
interface NoteLine {
  runs: Run[];
  kind?: NoteParagraph["kind"];
  startsSection: boolean;
  wordKey?: string;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 39;
const FOOTER = 48;
const BODY_X = 88;
const NOTES_X = 341;
const BODY_WIDTH = NOTES_X - BODY_X - 24;
const NOTES_WIDTH = PAGE_WIDTH - NOTES_X - MARGIN;
const LINE_HEIGHT = 15;
const NOTE_GAP = 11;
const EXAMPLE_INSET = 8;
const EXAMPLE_SLANT_ALLOWANCE = 2;
const LABELS = "TUBITLE ? 0123456789:/#.-";

const ink = rgb(.12, .16, .23);
const muted = rgb(.31, .36, .44);
const accent = rgb(.18, .26, .53);
const exampleColor = rgb(.08, .38, .36);
const exampleSlant = degrees(12);
const rule = rgb(.85, .88, .92);
const noteRule = rgb(.76, .81, .86);
const bidi = bidiFactory();
const highlightColor = rgb(1, .90, .52);

// Arabic joining forms are not all reachable through the font's cmap. Include
// the shaped glyphs in PDF width and Unicode tables, and retain the full font
// because fontkit subsetting can drop components of those joining forms.
class ShapedFontEmbedder extends CustomFontEmbedder {
  private readonly used = new Map<number, ReturnType<typeof this.font.layout>["glyphs"][number]>();
  constructor(bytes: Uint8Array) {
    super(fontkit.create(bytes), bytes);
    this.glyphCache = Cache.populatedBy(() => [...this.used.values()].sort((a, b) => a.id - b.id));
  }
  override encodeText(text: string) {
    for (const glyph of this.font.layout(text, this.fontFeatures).glyphs) this.used.set(glyph.id, glyph);
    this.glyphCache.invalidate();
    return super.encodeText(text);
  }
}

async function prepareFonts(pdf: PDFDocument, text: string, readAsset: (name: string) => Promise<ArrayBuffer>, language: string) {
  const faces = JSON.parse(new TextDecoder().decode(await readAsset("faces.json"))) as FontFace[];
  const preferred = language === "ja" ? "noto-sans-jp" : language === "ko" ? "noto-sans-kr" : language.startsWith("zh") ? "noto-sans-sc" : "noto-sans";
  faces.sort((a, b) => Number(b.family === preferred) - Number(a.family === preferred));
  const codePoints = new Set(Array.from(text, (char) => char.codePointAt(0)!));
  const assignments = new Map<number, PDFFont>();
  const shapedFonts: PDFFont[] = [];
  pdf.registerFontkit(fontkit);
  // Unicode ranges tell us which regular font subsets to open; no fonts are fetched from the network.
  for (const face of faces) {
    const ranges = face.ranges.split(",").map((part) => {
      const [left, right] = part.trim().slice(2).split("-");
      return [Number.parseInt(left!, 16), Number.parseInt(right ?? left!, 16)] as const;
    });
    const needed = [...codePoints].filter((code) => !assignments.has(code) && ranges.some(([start, end]) => code >= start && code <= end));
    if (!needed.length) continue;
    const bytes = new Uint8Array(await readAsset(face.file));
    const font = face.family === "noto-sans-arabic"
      ? PDFFont.of(pdf.context.nextRef(), pdf, new ShapedFontEmbedder(bytes))
      : await pdf.embedFont(bytes, { subset: true });
    if (face.family === "noto-sans-arabic") shapedFonts.push(font);
    const covered = new Set(font.getCharacterSet());
    for (const code of needed) if (covered.has(code)) assignments.set(code, font);
  }
  const fallback = assignments.get(63);
  if (!fallback) throw new Error("缺少 PDF 字体");
  const glyph = (char: string) => {
    const font = assignments.get(char.codePointAt(0)!);
    return { char: font ? char : "?", font: font ?? fallback };
  };
  return Object.assign(glyph, { flush: () => Promise.all(shapedFonts.map((font) => font.embed())) });
}

function getSourceParts(row: TranscriptNoteRow): TextPart[] {
  const parts: TextPart[] = [];
  let start = 0;
  for (const mark of row.highlights) {
    if (start < mark.start) parts.push({ text: row.text.slice(start, mark.start) });
    parts.push({ text: row.text.slice(mark.start, mark.end), highlight: true });
    start = mark.end;
  }
  if (start < row.text.length) parts.push({ text: row.text.slice(start) });
  return parts;
}

function getNoteSections(row: TranscriptNoteRow, translate: (text: string) => string): NoteSection[] {
  const sections: NoteSection[] = [];
  if (row.translation) sections.push({ paragraphs: [{ text: row.translation }] });
  if (row.explanation) sections.push({ paragraphs: [
    { text: translate("句子解析"), kind: "heading" }, { text: row.explanation }
  ] });
  for (const { word, senses } of row.words) {
    sections.push({
      wordKey: word.toLowerCase(),
      paragraphs: [
        { text: `${word}（${WORDNET_NAME}）`, kind: "heading" },
        ...senses.flatMap(({ partOfSpeech, definitions, examples }, index): NoteParagraph[] => [
          { text: `${index + 1}. ${partOfSpeech ? `[${partOfSpeech}] ` : ""}${definitions.join("; ")}` },
          ...examples.map((example): NoteParagraph => ({ text: `“${example}”`, kind: "example" }))
        ])
      ]
    });
  }
  return sections;
}

function fitNotes(lines: NoteLine[], start: number, available: number, freshPage = false) {
  let height = 0;
  let end = start;
  let safeEnd = start;
  let safeHeight = 0;
  while (end < lines.length) {
    const line = lines[end]!;
    const advance = LINE_HEIGHT + (end > start && line.startsSection ? NOTE_GAP : 0);
    if (height + advance > available) break;
    height += advance;
    end++;
    // Keep a note heading with its first line of content when it moves to a new page.
    if (line.kind !== "heading" || end === lines.length) {
      safeEnd = end;
      safeHeight = height;
    }
  }
  return freshPage && safeEnd === start ? { end, height } : { end: safeEnd, height: safeHeight };
}

export async function createTranscriptPdf(
  title: string,
  rows: TranscriptNoteRow[],
  readAsset: (name: string) => Promise<ArrayBuffer>,
  targetLanguage = "zh"
): Promise<Uint8Array<ArrayBuffer>> {
  const language = resolveUiLanguage(targetLanguage);
  const translate = (text: string, ...values: Array<string | number>) => translateForLanguage(language, text, ...values);
  const labels = {
    title: translate("字幕学习笔记"), source: translate("英文字幕"), notes: translate("学习旁批"), continued: translate("续")
  };
  const pdf = await PDFDocument.create();
  pdf.setLanguage(language);
  const logo = await pdf.embedPng(await readAsset("logo.png"));
  pdf.setTitle(title);
  pdf.setCreator("Tubitle");

  const hasWordNet = rows.some((row) => row.words.length > 0);
  const creditHeading = translate("词义来源与版权");
  const creditFooter = translate("词义来源：{0} · CC BY 4.0", WORDNET_NAME);
  const credit = [
    `${WORDNET_NAME} (${WORDNET_SITE}) ${WORDNET_COPYRIGHT}`,
    `CC BY 4.0: ${WORDNET_LICENSE}`,
    translate("节选释义和例句，重新排版。"),
    `Princeton WordNet license: ${PRINCETON_LICENSE}`,
    PRINCETON_NOTICE
  ].join("\n");
  const noteSections = rows.map((row) => getNoteSections(row, translate));
  const glyph = await prepareFonts(pdf, [LABELS, ...Object.values(labels), title, hasWordNet ? creditHeading + creditFooter + credit : "",
    ...rows.map((row) => row.text),
    ...noteSections.flatMap((sections) => sections.flatMap(({ paragraphs }) => paragraphs.map(({ text }) => text)))
  ].join("\n"), readAsset, language);
  function shape(text: string, size: number, highlight?: boolean): Run[] {
    const runs: Run[] = [];
    for (const codePoint of text) {
      const { char, font } = glyph(codePoint);
      const previous = runs.at(-1);
      if (previous?.font === font) previous.text += char;
      else runs.push({ text: char, font, width: 0, highlight });
    }
    for (const run of runs) run.width = run.font.widthOfTextAtSize(run.text, size);
    return runs;
  }

  // Keep logical text inside each shaped Arabic run, but position runs in visual
  // order so mixed Latin names, spaces and numbers remain readable.
  function visualRuns(line: Run[], size: number): Run[] {
    const text = line.map((run) => run.text).join("");
    if (!/\p{Script=Arabic}/u.test(text)) return line;
    const levels = bidi.getEmbeddingLevels(text);
    const indices = Array.from({ length: text.length }, (_, index) => index);
    for (const [start, end] of bidi.getReorderSegments(text, levels)) {
      indices.splice(start, end - start + 1, ...indices.slice(start, end + 1).reverse());
    }
    const positions = new Map(indices.map((logical, visual) => [logical, visual]));
    const mirrored = bidi.getMirroredCharactersMap(text, levels);
    const chunks: Array<Run & { position: number }> = [];
    let offset = 0;
    for (const run of line) {
      let start = 0;
      while (start < run.text.length) {
        let end = start + 1;
        while (end < run.text.length && levels.levels[offset + end] === levels.levels[offset + start]) end++;
        const logical = run.text.slice(start, end).split("").map((char, index) => mirrored.get(offset + start + index) || char).join("");
        let position = Infinity;
        for (let index = start; index < end; index++) position = Math.min(position, positions.get(offset + index)!);
        chunks.push({ ...run, text: logical, width: run.font.widthOfTextAtSize(logical, size), position });
        start = end;
      }
      offset += run.text.length;
    }
    return chunks.sort((a, b) => a.position - b.position);
  }

  function wrap(parts: TextPart[], width: number, size: number): Run[][] {
    const lines: Run[][] = [];
    let line: Run[] = [];
    let used = 0;
    let space: Run[] = [];
    function flush() {
      lines.push(line);
      line = [];
      space = [];
      used = 0;
    }
    function append(runs: Run[]) {
      for (const run of runs) {
        const previous = line.at(-1);
        if (previous?.font === run.font && previous.highlight === run.highlight) {
          previous.text += run.text;
          previous.width += run.width;
        } else line.push({ ...run });
        used += run.width;
      }
    }
    for (const { text, highlight } of parts) {
      // Wrap Latin text on words and CJK text at character boundaries.
      const pieces = text.match(/\n|[^\S\n]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][、。，；！？：）】」』]?|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? [];
      for (const piece of pieces) {
        if (piece === "\n") { flush(); continue; }
        if (/^\s+$/.test(piece)) { if (used > 0) space = shape(" ", size); continue; }
        const runs = shape(piece, size, highlight);
        const runWidth = runs.reduce((total, run) => total + run.width, 0);
        if (used && used + (space[0]?.width ?? 0) + runWidth > width) flush();
        append(space);
        space = [];
        if (runWidth <= width) append(runs);
        else {
          for (const char of piece) {
            const character = shape(char, size, highlight);
            if (used && used + character[0]!.width > width) flush();
            append(character);
          }
        }
      }
    }
    if (line.length) flush();
    return lines;
  }

  function draw(page: PDFPage, line: Run[], x: number, y: number, size: number, color = ink, italic = false, alignWidth?: number) {
    const ordered = visualRuns(line, size);
    if (alignWidth && bidi.getEmbeddingLevels(line.map((run) => run.text).join("")).paragraphs[0]?.level === 1) {
      x += Math.max(0, alignWidth - ordered.reduce((total, run) => total + run.width, 0));
    }
    for (const run of ordered) {
      if (run.highlight) page.drawRectangle({ x, y: y - 2.5, width: run.width, height: size + 4, color: highlightColor });
      // pdf-lib's ySkew shears glyphs horizontally while keeping the baseline level.
      page.drawText(run.text, { x, y, size, color, font: run.font, ySkew: italic ? exampleSlant : undefined });
      x += run.width;
    }
  }

  const pageWords = new Set<string>();
  const titleLines = wrap([{ text: title }], PAGE_WIDTH - 2 * MARGIN, 17).slice(0, 3);
  const bodyTop = PAGE_HEIGHT - 113 - titleLines.length * 21;
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = bodyTop;
  const rowGap = 10;
  function newPage(target = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]), columns = true) {
    page = target;
    pageWords.clear();
    y = bodyTop;
    page.drawImage(logo, { x: MARGIN, y: PAGE_HEIGHT - 42, width: 16, height: 16 });
    draw(page, shape(`TUBITLE  /  ${labels.title}`, 9), MARGIN + 22, PAGE_HEIGHT - 39, 9, accent);
    titleLines.forEach((line, index) => draw(page, line, MARGIN, PAGE_HEIGHT - 66 - 21 * index, 17));
    page.drawLine({ start: { x: MARGIN, y: y + 35 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 35 }, color: accent, thickness: 1 });
    if (columns) {
      draw(page, shape(labels.source, 9), BODY_X, y + 20, 9, accent, false, BODY_WIDTH);
      draw(page, shape(labels.notes, 9), NOTES_X, y + 20, 9, accent, false, NOTES_WIDTH);
    }
  }

  newPage(page);
  rows.forEach((row, index) => {
    const source = wrap(getSourceParts(row), BODY_WIDTH, 11);
    const sections = noteSections[index]!.map(({ paragraphs, wordKey }) => {
      const lines = paragraphs.flatMap(({ text, kind }) =>
        wrap([{ text }], NOTES_WIDTH - (kind === "example" ? EXAMPLE_INSET + EXAMPLE_SLANT_ALLOWANCE : 0), 9.5)
          .map((runs) => ({ runs, kind, wordKey, startsSection: false })));
      if (lines[0]) lines[0].startsSection = true;
      return { wordKey, lines };
    });
    const visibleNotes = () => sections.flatMap(({ wordKey, lines }) => wordKey && pageWords.has(wordKey) ? [] : lines);
    let notes = visibleNotes();
    if (y < bodyTop && (Math.max(source.length, 1) * LINE_HEIGHT > y - FOOTER ||
      fitNotes(notes, 0, y - FOOTER).end < notes.length)) {
      newPage();
      notes = visibleNotes();
    }
    let sourceOffset = 0;
    let noteOffset = 0;
    let continued = false;
    do {
      if (continued) newPage();
      const available = y - FOOTER;
      const sourceEnd = Math.min(sourceOffset + Math.floor(available / LINE_HEIGHT), source.length);
      const noteFit = fitNotes(notes, noteOffset, available, y === bodyTop);
      const rowTop = y + 12;
      draw(page, shape(formatCaptionTime(row.startMs), 8), MARGIN, y, 8, muted);
      draw(page, shape(`#${index + 1}`, 8), MARGIN, y - 11, 8, muted);
      if (continued) {
        const gutterWidth = BODY_X - MARGIN - 8;
        const measured = shape(labels.continued, 7).reduce((total, run) => total + run.width, 0);
        const size = Math.min(7, 7 * gutterWidth / measured);
        draw(page, shape(labels.continued, size), MARGIN, y - 21, size, muted);
      }
      for (let i = sourceOffset; i < sourceEnd; i++) {
        draw(page, source[i]!, BODY_X, y - (i - sourceOffset) * LINE_HEIGHT, 11);
      }
      let noteY = y;
      for (let i = noteOffset; i < noteFit.end; i++) {
        const { runs, kind, startsSection, wordKey } = notes[i]!;
        if (i > noteOffset && startsSection) {
          page.drawLine({ start: { x: NOTES_X, y: noteY + 2 }, end: { x: NOTES_X + NOTES_WIDTH, y: noteY + 2 },
            color: noteRule, thickness: .55 });
          noteY -= NOTE_GAP;
        }
        draw(page, runs, NOTES_X + (kind === "example" ? EXAMPLE_INSET : 0), noteY, 9.5,
          kind === "example" ? exampleColor : kind === "heading" ? accent : muted, kind === "example",
          NOTES_WIDTH - (kind === "example" ? EXAMPLE_INSET : 0));
        noteY -= LINE_HEIGHT;
        if (wordKey) pageWords.add(wordKey);
      }
      y -= Math.max((sourceEnd - sourceOffset) * LINE_HEIGHT, noteFit.height, LINE_HEIGHT);
      page.drawLine({ start: { x: NOTES_X - 12, y: rowTop }, end: { x: NOTES_X - 12, y: y + 2 }, color: rule, thickness: .6 });
      sourceOffset = sourceEnd;
      noteOffset = noteFit.end;
      continued = true;
    } while (sourceOffset < source.length || noteOffset < notes.length);
    page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 2 }, color: rule, thickness: .45 });
    y -= rowGap;
  });

  if (hasWordNet) {
    const lines = wrap([{ text: credit }], PAGE_WIDTH - MARGIN * 2, 8);
    const height = 22 + lines.length * 11;
    if (y - height < FOOTER) {
      newPage(undefined, false);
    }
    draw(page, shape(creditHeading, 10), MARGIN, y, 10, accent);
    lines.forEach((line, index) => draw(page, line, MARGIN, y - 18 - index * 11, 8, muted));
  }

  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    if (hasWordNet) draw(item, shape(creditFooter, 8), MARGIN, 28, 8, muted);
    draw(item, shape(`${index + 1} / ${pages.length}`, 8), PAGE_WIDTH - MARGIN - 35, 28, 8, muted);
  });
  await glyph.flush();
  return new Uint8Array(await pdf.save());
}

export async function downloadTranscriptPdf(title: string, rows: TranscriptNoteRow[]): Promise<void> {
  const settings = await getSettings();
  const bytes = await createTranscriptPdf(title, rows, async (name) => {
    const response = await fetch(chrome.runtime.getURL(`pdf-fonts/${name}`));
    if (!response.ok) throw new Error("无法读取 PDF 字体");
    return response.arrayBuffer();
  }, settings.targetLanguage);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").slice(0, 100).trim() || "Tubitle"} - tubitle.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
