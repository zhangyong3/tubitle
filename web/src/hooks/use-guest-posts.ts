// Guest posts on the client: types, the public info query and display
// helpers shared by the author pages, the admin review page and /guest-post.
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/lib/api-client';
import { countWords, extractExternalLinks } from '@/lib/guest-post-rules';
import { getLocale } from '@/paraglide/runtime.js';

export { countWords };

export type GuestPostStatus =
  | 'draft'
  | 'submitted'
  | 'changes_requested'
  | 'published'
  | 'rejected'
  | 'unpublished';

export interface GuestPostPackage {
  productId: string;
  planName: string;
  description: string;
  priceInCents: number;
  currency: string;
  cnyPriceInCents: number | null;
  maxLinks: number;
}

export interface GuestPostInfo {
  enabled: boolean;
  minWords: number;
  packages: GuestPostPackage[];
}

export interface GuestPostRow {
  id: string;
  postId: string;
  productId: string;
  status: GuestPostStatus;
  reviewNote: string | null;
  orderNo: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  title: string | null;
  slug: string | null;
  userId?: string;
  userName?: string | null;
  userEmail?: string | null;
  userAvatar?: string | null;
}

/** Public rules + packages; shared cache across pages. */
export function useGuestPostInfo() {
  return useQuery({
    queryKey: ['guest-post-info'],
    queryFn: () => apiGet<GuestPostInfo>('/api/guest-posts/info'),
    staleTime: 60_000,
  });
}

export function formatPrice(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(getLocale(), {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString(getLocale());
}

/** External links, counted exactly like the server. */
export function countExternalLinks(markdown: string): number {
  return extractExternalLinks(markdown).length;
}

export type SubmitProblem =
  | { kind: 'title' }
  | { kind: 'words'; count: number; min: number }
  | { kind: 'links'; count: number; max: number };

/**
 * Why the article can't be paid for and submitted yet, checked before any
 * save or checkout so a failed attempt has no side effects. Same rules as the
 * server (modules/guest-posts → validateForReview), which still enforces them.
 */
export function guestPostSubmitProblem(a: {
  title: string;
  content: string;
  minWords: number;
  maxLinks: number;
}): SubmitProblem | null {
  if (!a.title.trim()) return { kind: 'title' };
  const words = countWords(a.content);
  if (words < a.minWords)
    return { kind: 'words', count: words, min: a.minWords };
  const links = countExternalLinks(a.content);
  if (links > a.maxLinks)
    return { kind: 'links', count: links, max: a.maxLinks };
  return null;
}

/** "Standard · $99.00" for a package id, from the public package list. */
export function packageLabel(
  productId: string,
  packages: GuestPostPackage[] | undefined
) {
  const pkg = packages?.find((p) => p.productId === productId);
  return pkg
    ? `${pkg.planName} · ${formatPrice(pkg.priceInCents, pkg.currency)}`
    : productId;
}
