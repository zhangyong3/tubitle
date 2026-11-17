import MarkdownIt from 'markdown-it';

// Guest post counting rules, shared by the server checks
// (modules/guest-posts) and the editor's live hints, so both always agree.

const linkParser = new MarkdownIt({ html: false, linkify: true });

/**
 * External (http/https) links in a markdown body, including bare URLs that
 * linkify turns into links. A link whose text is its own URL counts once;
 * images and code don't count.
 */
export function extractExternalLinks(markdown: string): string[] {
  const links: string[] = [];
  for (const block of linkParser.parse(markdown || '', {})) {
    for (const token of block.children ?? []) {
      if (token.type !== 'link_open') continue;
      const href = token.attrGet('href') || '';
      if (/^https?:\/\//i.test(href)) links.push(href);
    }
  }
  return links;
}

/** Words for Latin text plus one per CJK character. */
export function countWords(markdown: string): number {
  const text = (markdown || '').replace(/[#>*_`~\-[\]()!|]/g, ' ');
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const latin =
    text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[\p{L}\p{N}]+/gu)
      ?.length ?? 0;
  return cjk + latin;
}
