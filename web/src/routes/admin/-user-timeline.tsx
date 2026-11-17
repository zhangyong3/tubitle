import { useState, type ReactNode } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  RefreshCw,
} from 'lucide-react';

import { tDynamic } from '@/core/i18n/dynamic';
import { getEventDefinition, type EventTone } from '@/config/events';
import { apiGet } from '@/lib/api-client';
import { formatDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type Detail = Record<string, string | number | boolean | null>;

interface TimelineEvent {
  key: string;
  at: string;
  kind: string;
  detail: Detail;
  ref?: { type: 'order' | 'subscription' | 'credit' | 'ticket'; id: string };
  href?: string;
}

interface TimelinePage {
  items: TimelineEvent[];
  nextCursor: string | null;
}

// Dot colour: green = money in, red = failures and money out, amber = the
// user moving toward paying, grey = everything else.
const TONE_CLASSES: Record<EventTone, string> = {
  green: 'bg-emerald-500',
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  gray: 'bg-muted-foreground/50',
};

function toneOf(kind: string) {
  const tone = getEventDefinition(kind)?.tone;
  return TONES[kind] || (tone ? TONE_CLASSES[tone] : TONE_CLASSES.gray);
}

// Registered kinds without a translation fall back to the kind itself.
function labelOf(kind: string) {
  const key = `admin.user_detail.timeline_${kind}`;
  const label = tDynamic(key);
  return label === key ? kind : label;
}

const TONES: Record<string, string> = {
  order_paid: 'bg-emerald-500',
  subscription_started: 'bg-emerald-500',
  order_failed: 'bg-red-500',
  order_refunded: 'bg-red-500',
  subscription_canceled: 'bg-red-500',
  task_failed: 'bg-red-500',
  order_created: 'bg-amber-500',
};

function money(amount: unknown, currency: unknown) {
  if (typeof amount !== 'number') return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(currency || 'USD'),
    }).format(amount / 100);
  } catch {
    return `${amount / 100} ${currency ?? ''}`.trim();
  }
}

function describe(kind: string, d: Detail): string {
  const parts: unknown[] = (() => {
    switch (kind) {
      case 'signup':
        return [d.source, d.referrer, d.country];
      case 'order_created':
      case 'order_paid':
        return [d.product, money(d.amount, d.currency), d.provider];
      case 'order_failed':
        return [d.product, d.orderNo];
      case 'order_refunded':
        return [money(d.amount, d.currency), d.orderNo];
      case 'subscription_started':
        return [d.product, d.interval, money(d.amount, d.currency)];
      case 'subscription_canceled':
        return [d.product, d.reason];
      case 'credits_granted':
        return [`+${d.credits}`, d.description || d.scene];
      case 'credits_consumed':
        return [`-${d.credits}`, d.description || d.scene];
      case 'task_created':
        return [
          d.mediaType,
          d.model,
          d.cost ? m['admin.user_detail.timeline_cost']({ cost: d.cost }) : '',
        ];
      case 'task_succeeded':
      case 'task_failed':
        return [d.mediaType, d.model];
      case 'ticket_opened':
        return [d.title];
      default:
        // Product events and custom sources: show the detail values.
        return Object.values(d).map((v) =>
          typeof v === 'boolean' ? String(v) : v
        );
    }
  })();
  return parts
    .filter((p) => p !== null && p !== undefined && p !== '')
    .join(' · ');
}

export function UserTimeline({ userId }: { userId: string }) {
  // Oldest first by default: reads top to bottom as the user's journey.
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const query = useInfiniteQuery({
    queryKey: ['admin-user-timeline', userId, order],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ userId, order });
      if (pageParam) params.set('cursor', pageParam);
      return apiGet<TimelinePage>(`/api/admin/users/timeline?${params}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  });

  const events = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{m['admin.user_detail.timeline_title']()}</CardTitle>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}
          >
            {order === 'asc' ? (
              <ArrowDownNarrowWide className="size-4" />
            ) : (
              <ArrowUpNarrowWide className="size-4" />
            )}
            {order === 'asc'
              ? m['admin.user_detail.timeline_oldest_first']()
              : m['admin.user_detail.timeline_newest_first']()}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => query.refetch()}
            aria-label={m['admin.user_detail.timeline_refresh']()}
          >
            <RefreshCw
              className={cn('size-4', query.isFetching && 'animate-spin')}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <p className="text-muted-foreground text-sm">{query.error.message}</p>
        ) : events.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {m['admin.user_detail.timeline_empty']()}
          </p>
        ) : (
          <ol className="border-border relative ml-1.5 border-l">
            {events.map((e) => {
              const detail = describe(e.kind, e.detail);
              const title = labelOf(e.kind);
              return (
                <li key={e.key} className="relative">
                  <span
                    className={cn(
                      'ring-background pointer-events-none absolute top-1/2 -left-[5px] z-10 size-2.5 -translate-y-1/2 rounded-full ring-2',
                      toneOf(e.kind)
                    )}
                  />
                  <EventRow eventRef={e.ref} href={e.href}>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {formatDateTime(e.at)}
                    </span>
                    <span className="shrink-0 font-medium">{title}</span>
                    {detail && (
                      <span
                        className="text-muted-foreground min-w-0 truncate"
                        title={detail}
                      >
                        {detail}
                      </span>
                    )}
                  </EventRow>
                </li>
              );
            })}
          </ol>
        )}
        {query.hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {m['admin.user_detail.timeline_more']()}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const ROW =
  'ml-2 flex min-w-0 items-baseline gap-3 rounded-md py-1.5 pr-2 pl-3 text-sm';

// The whole row opens the record it came from (in a new tab, keeping the
// timeline where it was). Events without an admin page stay plain.
function EventRow({
  eventRef,
  href,
  children,
}: {
  eventRef?: TimelineEvent['ref'];
  href?: string;
  children: ReactNode;
}) {
  const className = cn(ROW, 'hover:bg-muted transition-colors');
  if (href)
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {children}
      </a>
    );
  if (!eventRef) return <div className={ROW}>{children}</div>;
  switch (eventRef.type) {
    case 'order':
      return (
        <Link
          to="/admin/payments"
          search={{ search: eventRef.id }}
          target="_blank"
          className={className}
        >
          {children}
        </Link>
      );
    case 'subscription':
      return (
        <Link
          to="/admin/subscriptions"
          search={{ search: eventRef.id }}
          target="_blank"
          className={className}
        >
          {children}
        </Link>
      );
    case 'credit':
      return (
        <Link
          to="/admin/credits"
          search={{ search: eventRef.id }}
          target="_blank"
          className={className}
        >
          {children}
        </Link>
      );
    case 'ticket':
      return (
        <Link
          to="/admin/tickets"
          search={{ id: eventRef.id }}
          target="_blank"
          className={className}
        >
          {children}
        </Link>
      );
  }
}
