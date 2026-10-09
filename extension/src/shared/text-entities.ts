const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: "\u00a0",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—",
  hellip: "…", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™",
  laquo: "«", raquo: "»", ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009"
};

/** Decode text only, without parsing HTML or inserting markup into the page. */
export function decodeTextEntities(value: string): string {
  let result = value;
  // Some caption sources escape entities twice (e.g. &amp;#39;).
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = result.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity: string, name: string) => {
      if (!name.startsWith("#")) return NAMED_ENTITIES[name] ?? entity;
      const hexadecimal = name[1]?.toLowerCase() === "x";
      const code = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return entity;
      return String.fromCodePoint(code);
    });
    if (decoded === result) break;
    result = decoded;
  }
  return result;
}
