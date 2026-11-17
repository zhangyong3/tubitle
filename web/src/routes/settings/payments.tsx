import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';

import { tDynamic } from '@/core/i18n/dynamic';
import { Link } from '@/core/i18n/navigation';
import { apiGet, type PageResult } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { DataTable, type Column } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { FeatureGate } from './-feature-gate';

type Order = {
  id: string;
  orderNo: string;
  status: string;
  amount: number;
  currency: string;
  paymentProvider: string;
  paymentType?: string | null;
  productName?: string | null;
  planName?: string | null;
  invoiceUrl?: string | null;
  paidAt?: string | null;
  createdAt: string;
  /** Set when the order paid for a guest post. */
  guestPost?: { id: string; title: string } | null;
};

/** "Product · Plan", or one of them when they're the same / missing. */
function productLabel(o: Order) {
  if (o.guestPost) {
    return `${m['guest_posts.title']()} · ${o.planName || ''}`.trim();
  }
  if (o.productName && o.planName && o.planName !== o.productName) {
    return `${o.productName} · ${o.planName}`;
  }
  return o.planName || o.productName || '—';
}

const TABS = ['all', 'one-time', 'subscription', 'renew'] as const;
type Tab = (typeof TABS)[number];

const PAGE_SIZE = 20;

// Order statuses a buyer filters by (refunding is a brief in-between state).
const FILTER_STATUSES = ['paid', 'created', 'refunded', 'failed'];
const STATUS_LABELS = [
  'paid',
  'created',
  'pending',
  'refunding',
  'refunded',
  'failed',
];

function statusLabel(status: string) {
  return STATUS_LABELS.includes(status)
    ? tDynamic(`settings.payments.status_${status}`)
    : status;
}

function formatAmount(amount: number, currency: string) {
  const normalized = (currency || 'usd').toUpperCase();
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: normalized,
  }).format(amount / 100);
}

function statusVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = status.toLowerCase();
  if (s === 'paid' || s === 'succeeded' || s === 'active') return 'default';
  if (s === 'failed' || s === 'canceled') return 'destructive';
  return 'secondary';
}

function PaymentsPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('all');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [tab, debouncedSearch, status]);

  const query = useQuery({
    queryKey: ['user-payments', page, tab, debouncedSearch, status],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (tab !== 'all') params.set('paymentType', tab);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (status !== 'all') params.set('status', status);
      return apiGet<PageResult<Order>>(`/api/user/orders?${params}`);
    },
    placeholderData: keepPreviousData,
  });
  const orders = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const columns: Column<Order>[] = [
    {
      header: m['settings.payments.order_no'](),
      cell: (o) => <span className="font-mono text-xs">{o.orderNo}</span>,
    },
    {
      header: m['settings.payments.product'](),
      cell: (o) => (
        <div className="min-w-0">
          <span>{productLabel(o)}</span>
          {o.guestPost && (
            <Link
              href={`/settings/guest-posts/${o.guestPost.id}`}
              className="text-muted-foreground hover:text-foreground block max-w-[240px] truncate text-xs hover:underline"
            >
              {o.guestPost.title || '—'}
            </Link>
          )}
        </div>
      ),
    },
    {
      header: m['settings.payments.amount'](),
      cell: (o) => (
        <span className="font-medium">
          {formatAmount(o.amount, o.currency)}
        </span>
      ),
    },
    {
      header: m['settings.payments.status'](),
      cell: (o) => (
        <Badge variant={statusVariant(o.status)}>{statusLabel(o.status)}</Badge>
      ),
    },
    {
      header: m['settings.payments.type'](),
      // Same labels as the tabs (one-time / subscription / renew).
      cell: (o) =>
        o.paymentType && (TABS as readonly string[]).includes(o.paymentType)
          ? tDynamic(`settings.payments.tab_${o.paymentType.replace('-', '_')}`)
          : o.paymentType || '—',
    },
    {
      header: m['settings.payments.provider'](),
      cell: (o) => <span className="capitalize">{o.paymentProvider}</span>,
    },
    {
      header: m['settings.payments.date'](),
      cell: (o) => (
        <span className="text-muted-foreground text-sm">
          {new Date(o.paidAt || o.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      header: m['settings.payments.invoice'](),
      className: 'w-[60px]',
      cell: (o) =>
        o.invoiceUrl ? (
          <a
            href={o.invoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
            aria-label={m['settings.payments.invoice']()}
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{m['settings.payments.title']()}</h1>
        <p className="text-muted-foreground">
          {m['settings.payments.description']()}
        </p>
      </div>

      <div className="border-border flex gap-1 overflow-x-auto overflow-y-hidden border-b">
        {TABS.map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors',
              tab === tb
                ? 'border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            )}
          >
            {tDynamic(`settings.payments.tab_${tb.replace('-', '_')}`)}
          </button>
        ))}
      </div>

      <Card>
        <CardContent>
          <DataTable
            columns={columns}
            data={orders}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            rowKey={(o) => o.id}
            emptyText={m['settings.payments.no_payments']()}
            search={search}
            onSearchChange={setSearch}
            toolbar={
              <Select
                value={status}
                onValueChange={(value) => setStatus(value || 'all')}
              >
                <SelectTrigger className="h-9 w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {m['settings.payments.status_all']()}
                  </SelectItem>
                  {FILTER_STATUSES.map((st) => (
                    <SelectItem key={st} value={st}>
                      {statusLabel(st)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            onRefresh={() => query.refetch()}
            loading={query.isFetching || query.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/settings/payments')({
  component: () => (
    <FeatureGate feature="payments">
      <PaymentsPage />
    </FeatureGate>
  ),
});
