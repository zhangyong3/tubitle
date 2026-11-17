// Server-side markdown renderer for database-backed posts.
// Local MDX posts render through mdx-components.tsx instead — the
// wrapper classes below mirror those styles so both sources look alike.
import MarkdownIt from 'markdown-it';

import { cn } from '@/lib/utils';

function generateHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
});

// Headings get stable IDs so in-content anchors work
md.renderer.rules.heading_open = function (tokens, idx) {
  const token = tokens[idx];
  const level = token.markup.length;
  const nextToken = tokens[idx + 1];

  if (nextToken && nextToken.type === 'inline') {
    return `<h${level} id="${generateHeadingId(nextToken.content)}">`;
  }
  return `<h${level}>`;
};

/**
 * `href` tagged with utm_source/utm_medium, so the linked site can see the
 * traffic in its analytics. Links that already carry any utm_ parameter (the
 * author's own tracking) and URLs that don't parse are left as they are.
 */
function withUtm(href: string, source: string, medium: string) {
  try {
    const url = new URL(href);
    for (const key of url.searchParams.keys()) {
      if (key.toLowerCase().startsWith('utm_')) return href;
    }
    url.searchParams.set('utm_source', source);
    url.searchParams.set('utm_medium', medium);
    return url.toString();
  } catch {
    return href;
  }
}

// External links open in a new tab with nofollow; in paid content
// (env.sponsored) also rel="sponsored", as search engines require.
// env.utmSource tags them for the linked site's analytics.
md.renderer.rules.link_open = function (tokens, idx, options, env, renderer) {
  const token = tokens[idx];
  const href = token.attrGet('href');
  if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
    if (env?.utmSource) {
      token.attrSet('href', withUtm(href, env.utmSource, env.utmMedium));
    }
    token.attrSet(
      'rel',
      env?.sponsored ? 'sponsored nofollow noopener' : 'nofollow noopener'
    );
    token.attrSet('target', '_blank');
  }
  return renderer.renderToken(tokens, idx, options);
};

// Shared typography for rendered markdown — also used by the admin rich-text
// editor so what you edit matches what the public pages render.
export const markdownStyles = cn(
  'text-[15px] leading-7 text-foreground/90',
  '[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-foreground md:[&_h1]:text-2xl',
  '[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground md:[&_h2]:text-xl',
  '[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:text-foreground',
  '[&_p]:mt-2 [&_p]:leading-7',
  '[&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline',
  '[&_ul]:mt-2 [&_ul]:ml-6 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:marker:text-muted-foreground',
  '[&_ol]:mt-2 [&_ol]:ml-6 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:marker:text-muted-foreground',
  '[&_li]:leading-7',
  '[&_strong]:font-semibold [&_strong]:text-foreground',
  '[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-[0.4rem] [&_code]:py-[0.2rem] [&_code]:font-mono [&_code]:text-sm [&_code]:text-foreground',
  '[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_hr]:my-8 [&_hr]:border-border',
  '[&_img]:my-4 [&_img]:rounded-xl',
  '[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2'
);

export function MarkdownContent({
  content,
  className,
  sponsored = false,
  utm,
}: {
  content: string;
  className?: string;
  /** Paid content: external links get rel="sponsored". */
  sponsored?: boolean;
  /** Tag external links with utm_source/utm_medium (unless already tagged). */
  utm?: { source: string; medium: string };
}) {
  const html = content
    ? md.render(content, {
        sponsored,
        utmSource: utm?.source,
        utmMedium: utm?.medium,
      })
    : '';

  return (
    <div
      className={cn(markdownStyles, className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
