declare module "bidi-js" {
  interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: Array<{ start: number; end: number; level: number }>;
  }
  export default function bidiFactory(): {
    getEmbeddingLevels(text: string, direction?: "ltr" | "rtl"): EmbeddingLevels;
    getReorderSegments(text: string, levels: EmbeddingLevels): Array<[number, number]>;
    getMirroredCharactersMap(text: string, levels: EmbeddingLevels): Map<number, string>;
  };
}
