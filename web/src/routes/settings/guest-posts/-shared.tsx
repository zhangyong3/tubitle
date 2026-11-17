import { MessageSquareText } from 'lucide-react';

import { tDynamic } from '@/core/i18n/dynamic';
import { m } from '@/paraglide/messages.js';
import { localizeHref } from '@/paraglide/runtime.js';
import {
  packageLabel,
  type GuestPostPackage,
  type GuestPostStatus,
  type SubmitProblem,
} from '@/hooks/use-guest-posts';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const BADGE: Record<
  GuestPostStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  draft: 'outline',
  submitted: 'secondary',
  changes_requested: 'outline',
  published: 'default',
  rejected: 'destructive',
  unpublished: 'outline',
};

/** States where the reviewer's note explains what happened. */
export const NOTE_STATUSES: GuestPostStatus[] = [
  'changes_requested',
  'rejected',
  'unpublished',
];

/**
 * Status badge. Pass `note` to show the reviewer's note on hover (only in
 * states it explains; an earlier note shouldn't linger after a resubmit).
 */
export function GuestPostStatusBadge({
  status,
  note,
}: {
  status: GuestPostStatus;
  note?: string | null;
}) {
  const badge = (
    <Badge variant={BADGE[status] ?? 'outline'}>
      {tDynamic(`guest_posts.status_${status}`)}
    </Badge>
  );
  if (!note || !NOTE_STATUSES.includes(status)) return badge;
  return (
    <span className="inline-flex items-center gap-1.5">
      {badge}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={m['guest_posts.review_note']()}
              className="text-muted-foreground hover:text-foreground inline-flex"
            />
          }
        >
          <MessageSquareText className="size-4" />
        </TooltipTrigger>
        <TooltipContent className="block max-w-xs whitespace-pre-line">
          <span className="mb-0.5 block font-medium">
            {m['guest_posts.review_note']()}
          </span>
          {note}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}

/** Localized message for a pre-submit check that failed. */
export function describeSubmitProblem(p: SubmitProblem) {
  if (p.kind === 'title') return m['guest_posts.err_title']();
  if (p.kind === 'words')
    return m['guest_posts.err_words']({ min: p.min, count: p.count });
  return m['guest_posts.err_links']({ max: p.max, count: p.count });
}

/** The article URL; opens it (a preview until published) in a new tab. */
export function ArticleUrl({
  slug,
  status,
}: {
  slug: string | null;
  status: GuestPostStatus;
}) {
  if (!slug) return null;
  const path = `/blog/${slug}`;
  return (
    <a
      href={localizeHref(status === 'published' ? path : `${path}?preview=1`)}
      target="_blank"
      rel="noopener"
      className="text-muted-foreground hover:text-foreground block max-w-[320px] truncate font-mono text-xs hover:underline"
    >
      {path}
    </a>
  );
}

/** Package name and price, with what it includes underneath. */
export function PackageCell({
  productId,
  packages,
}: {
  productId: string;
  packages: GuestPostPackage[] | undefined;
}) {
  const pkg = packages?.find((p) => p.productId === productId);
  return (
    <div className="text-muted-foreground">
      <span>{packageLabel(productId, packages)}</span>
      {pkg && (
        <span className="block text-xs">
          {m['guest_posts.package_links']({ count: pkg.maxLinks })}
        </span>
      )}
    </div>
  );
}

/** The reviewer's note as a table cell (two lines; full text on hover). */
export function ReviewNoteCell({
  status,
  note,
}: {
  status: GuestPostStatus;
  note: string | null;
}) {
  if (!note || !NOTE_STATUSES.includes(status)) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      title={note}
      className="text-muted-foreground line-clamp-2 max-w-[320px] text-sm whitespace-pre-line"
    >
      {note}
    </span>
  );
}
