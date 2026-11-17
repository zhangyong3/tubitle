import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { inflateSync } from "node:zlib";

function unpackTrueType(woff, file) {
  // Restore the original sfnt tables using the WOFF 1.0 directory.
  // https://www.w3.org/TR/WOFF/
  if (woff.toString("ascii", 0, 4) !== "wOFF" || woff.readUInt32BE(4) !== 0x00010000) {
    throw new Error(`Expected a WOFF-wrapped TrueType font: ${file}`);
  }
  const tableCount = woff.readUInt16BE(12);
  const sfnt = Buffer.alloc(woff.readUInt32BE(16));
  const entrySelector = Math.floor(Math.log2(tableCount));
  const searchRange = 16 * 2 ** entrySelector;
  sfnt.writeUInt32BE(0x00010000, 0);
  sfnt.writeUInt16BE(tableCount, 4);
  sfnt.writeUInt16BE(searchRange, 6);
  sfnt.writeUInt16BE(entrySelector, 8);
  sfnt.writeUInt16BE(tableCount * 16 - searchRange, 10);

  let offset = 12 + tableCount * 16;
  let checksumOffset;
  for (let index = 0; index < tableCount; index++) {
    const entry = 44 + index * 20;
    const source = woff.readUInt32BE(entry + 4);
    const packedSize = woff.readUInt32BE(entry + 8);
    const size = woff.readUInt32BE(entry + 12);
    const checksum = woff.readUInt32BE(entry + 16);
    const packed = woff.subarray(source, source + packedSize);
    const table = packedSize < size ? inflateSync(packed, { maxOutputLength: size }) : packed;
    if (table.length !== size || offset + size > sfnt.length) throw new Error(`Invalid WOFF table: ${file}`);
    const record = 12 + index * 16;
    woff.copy(sfnt, record, entry, entry + 4);
    sfnt.writeUInt32BE(checksum, record + 4);
    sfnt.writeUInt32BE(offset, record + 8);
    sfnt.writeUInt32BE(size, record + 12);
    table.copy(sfnt, offset);
    if (woff.toString("ascii", entry, entry + 4) === "head") checksumOffset = offset + 8;
    offset += Math.ceil(size / 4) * 4;
  }
  if (offset !== sfnt.length || checksumOffset === undefined) throw new Error(`Invalid WOFF font: ${file}`);
  // The file checksum changes when the table offsets are rebuilt.
  sfnt.writeUInt32BE(0, checksumOffset);
  let sum = 0;
  for (let pos = 0; pos < sfnt.length; pos += 4) sum = (sum + sfnt.readUInt32BE(pos)) >>> 0;
  sfnt.writeUInt32BE((0xB1B0AFBA - sum) >>> 0, checksumOffset);
  return sfnt;
}

export async function copyPdfFontAssets(appDirectory, fontDirectory) {
  // Only ship regular faces; the exporter loads the subsets it needs locally.
  const require = createRequire(resolve(appDirectory, "package.json"));
  const families = ["noto-sans", "noto-sans-sc", "noto-sans-jp", "noto-sans-kr", "noto-sans-arabic", "noto-sans-thai"];
  await mkdir(fontDirectory, { recursive: true });
  const faces = [];
  for (const family of families) {
    const fontCssPath = require.resolve(`@fontsource/${family}/400.css`);
    const fontRoot = dirname(fontCssPath);
    const fontCss = await readFile(fontCssPath, "utf8");
    // Embed raw TrueType tables: WOFF2 subsetting can lose glyph outlines.
    const familyFaces = Array.from(fontCss.matchAll(/@font-face\s*\{([^}]+)\}/g), ([, block]) => ({
      source: block.match(/url\(\.\/files\/([^/)]+\.woff)\)/)?.[1],
      ranges: block.match(/unicode-range:\s*([^;]+)/)?.[1],
      family
    })).filter((face) => face.source && face.ranges);
    if (!familyFaces.length) throw new Error(`Missing Unicode ranges for PDF font: ${family}`);
    await Promise.all(familyFaces.map(async ({ source }) => {
      const bytes = await readFile(resolve(fontRoot, "files", source));
      await writeFile(resolve(fontDirectory, source.replace(/\.woff$/, ".ttf")), unpackTrueType(bytes, source));
    }));
    await cp(resolve(fontRoot, "LICENSE"), resolve(fontDirectory, `${family}-LICENSE`));
    faces.push(...familyFaces.map(({ source, ranges, family }) => ({ file: source.replace(/\.woff$/, ".ttf"), ranges, family })));
  }
  await Promise.all([
    cp(resolve(appDirectory, "public/icons/icon-128.png"), resolve(fontDirectory, "logo.png")),
    writeFile(resolve(fontDirectory, "faces.json"), JSON.stringify(faces))
  ]);
}
