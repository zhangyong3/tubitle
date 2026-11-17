import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, Copy } from 'lucide-react';
import { toast } from 'sonner';

import { tDynamic } from '@/core/i18n/dynamic';
import { apiGet, type PageResult } from '@/lib/api-client';
import { formatDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { DataTable, type Column } from '@/components/data-table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

import { UserTimeline } from './-user-timeline';

interface UserDetail {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    createdAt: string;
    utmSource: string;
    utmMedium: string;
    utmCampaign: string;
    utmTerm: string;
    utmContent: string;
    referrer: string;
    ip: string;
    country: string;
    locale: string;
  };
  roles: { roleId: string; roleName: string; roleTitle: string }[];
  stats: {
    creditBalance: number;
    creditsGranted: number;
    creditsConsumed: number;
    orderCount: number;
    lastOrderAt: string | null;
    paidOrderCount: number;
    paidAmounts: { currency: string; amount: number }[];
  };
}

interface Order {
  id: string;
  orderNo: string;
  status: string;
  amount: number;
  currency: string;
  paymentType: string | null;
  paymentProvider: string;
  productName: string | null;
  createdAt: string;
  paidAt: string | null;
}

interface Credit {
  id: string;
  transactionNo: string;
  transactionType: string;
  transactionScene: string | null;
  credits: number;
  remainingCredits: number;
  description: string | null;
  expiresAt: string | null;
  status: string;
  createdAt: string;
}

const PAGE_SIZE = 10;
const CREDIT_TYPES = ['grant', 'consume'] as const;
const CREDIT_STATUSES = ['active', 'expired', 'deleted'] as const;
const ORDER_STATUSES = [
  'pending',
  'created',
  'paid',
  'failed',
  'refunding',
  'refunded',
  'deleted',
] as const;
// Stored order.paymentType values → label keys (settings.payments.tab_*).
const ORDER_TYPES = [
  ['one-time', 'one_time'],
  ['subscription', 'subscription'],
  ['renew', 'renew'],
] as const;

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amount / 100);
}

const orderStatusVariant = (s: string) => {
  if (s === 'paid') return 'default';
  if (s === 'failed') return 'destructive';
  return 'secondary';
};

function Empty() {
  return <span className="text-muted-foreground">—</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-muted-foreground text-sm">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function UserDetailPage() {
  const { id } = Route.useParams();

  const detailQuery = useQuery({
    queryKey: ['admin-user', id],
    queryFn: () =>
      apiGet<UserDetail>(`/api/admin/users/${encodeURIComponent(id)}`),
  });

  if (detailQuery.isPending) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-16 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="space-y-4 p-6">
        <BackLink />
        <p className="text-muted-foreground">
          {detailQuery.error?.message || m['admin.user_detail.not_found']()}
        </p>
      </div>
    );
  }

  const { user, roles, stats } = detailQuery.data;
  const utmFields = [
    ['utm_source', user.utmSource],
    ['utm_medium', user.utmMedium],
    ['utm_campaign', user.utmCampaign],
    ['utm_term', user.utmTerm],
    ['utm_content', user.utmContent],
  ] as const;

  return (
    <div className="space-y-6 p-6">
      <BackLink />

      <div className="flex flex-wrap items-center gap-4">
        <Avatar className="size-14">
          <AvatarImage src={user.image || undefined} />
          <AvatarFallback>
            {(user.name || user.email).charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">{user.name || '—'}</h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
            <span className="truncate">{user.email}</span>
            <Badge variant={user.emailVerified ? 'default' : 'secondary'}>
              {user.emailVerified
                ? m['admin.user_detail.email_verified']()
                : m['admin.user_detail.email_unverified']()}
            </Badge>
            <span>
              {m['admin.user_detail.joined']({
                date: formatDateTime(user.createdAt),
              })}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard
              .writeText(user.email)
              .then(() => toast.success(m['admin.user_detail.copied']()));
          }}
        >
          <Copy className="size-4" />
          {m['admin.user_detail.copy_email']()}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={m['admin.user_detail.stat_balance']()}
          value={stats.creditBalance.toLocaleString()}
        />
        <Stat
          label={m['admin.user_detail.stat_granted']()}
          value={stats.creditsGranted.toLocaleString()}
        />
        <Stat
          label={m['admin.user_detail.stat_consumed']()}
          value={stats.creditsConsumed.toLocaleString()}
        />
        <Stat
          label={m['admin.user_detail.stat_paid']()}
          value={
            stats.paidAmounts.length > 0
              ? stats.paidAmounts
                  .map((p) => formatAmount(p.amount, p.currency))
                  .join(' + ')
              : formatAmount(0, 'USD')
          }
          hint={m['admin.user_detail.stat_orders']({
            paid: stats.paidOrderCount,
            total: stats.orderCount,
          })}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{m['admin.user_detail.attribution_title']()}</CardTitle>
          <CardDescription>
            {m['admin.user_detail.attribution_desc']()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 md:grid-cols-2">
            <div className="divide-y">
              <Field label={m['admin.user_detail.referrer']()}>
                {user.referrer ? (
                  <a
                    href={user.referrer}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="font-mono text-xs underline-offset-4 hover:underline"
                  >
                    {user.referrer}
                  </a>
                ) : (
                  <span className="text-muted-foreground">
                    {m['admin.user_detail.direct']()}
                  </span>
                )}
              </Field>
              {utmFields.map(([label, value]) => (
                <Field key={label} label={label}>
                  {value ? (
                    <span className="bg-muted inline-flex rounded-md px-2 py-0.5 text-xs font-medium">
                      {value}
                    </span>
                  ) : (
                    <Empty />
                  )}
                </Field>
              ))}
            </div>
            <div className="divide-y">
              <Field label={m['admin.user_detail.ip']()}>
                {user.ip ? (
                  <span className="font-mono text-xs">{user.ip}</span>
                ) : (
                  <Empty />
                )}
              </Field>
              <Field label={m['admin.user_detail.country']()}>
                {user.country || <Empty />}
              </Field>
              <Field label={m['admin.user_detail.locale']()}>
                {user.locale || <Empty />}
              </Field>
              <Field label={m['admin.user_detail.roles']()}>
                {roles.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {roles.map((r) => (
                      <Badge key={r.roleId} variant="outline">
                        {r.roleTitle || r.roleName}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">
                    {m['admin.user_detail.no_roles']()}
                  </span>
                )}
              </Field>
            </div>
          </dl>
        </CardContent>
      </Card>

      <UserTimeline userId={user.id} />
      <UserOrders userId={user.id} />
      <UserCredits userId={user.id} />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/admin/users"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
    >
      <ArrowLeft className="size-4" />
      {m['admin.user_detail.back']()}
    </Link>
  );
}

function UserOrders({ userId }: { userId: string }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const [paymentType, setPaymentType] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [status, paymentType, debouncedSearch]);

  const query = useQuery({
    queryKey: [
      'admin-user-orders',
      userId,
      page,
      status,
      paymentType,
      debouncedSearch,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        userId,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (status !== 'all') params.set('status', status);
      if (paymentType !== 'all') params.set('paymentType', paymentType);
      if (debouncedSearch) params.set('search', debouncedSearch);
      return apiGet<PageResult<Order>>(`/api/admin/orders?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const columns: Column<Order>[] = [
    {
      header: m['admin.payments.order_no'](),
      cell: (o) => <span className="font-mono text-xs">{o.orderNo}</span>,
    },
    {
      header: m['admin.payments.product_name_label'](),
      cell: (o) => o.productName || '—',
    },
    {
      header: m['admin.payments.amount'](),
      cell: (o) => (
        <span className="font-medium">
          {formatAmount(o.amount, o.currency)}
        </span>
      ),
    },
    {
      header: m['admin.payments.status'](),
      cell: (o) => (
        <Badge variant={orderStatusVariant(o.status)}>
          {tDynamic(`admin.payments.status_${o.status}`)}
        </Badge>
      ),
    },
    {
      header: m['admin.payments.type'](),
      cell: (o) => {
        const type = ORDER_TYPES.find(([value]) => value === o.paymentType);
        return type
          ? tDynamic(`settings.payments.tab_${type[1]}`)
          : o.paymentType || '—';
      },
    },
    {
      header: m['admin.payments.provider'](),
      cell: (o) => o.paymentProvider,
    },
    {
      header: m['admin.payments.created_at'](),
      cell: (o) => (
        <span className="text-muted-foreground text-sm">
          {formatDateTime(o.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m['admin.user_detail.orders_title']()}</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={query.data?.items ?? []}
          total={query.data?.total ?? 0}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          rowKey={(o) => o.id}
          emptyText={m['admin.payments.no_payments']()}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder={m['admin.user_detail.order_search']()}
          toolbar={
            <div className="flex gap-2">
              <Select
                value={status}
                onValueChange={(value) => setStatus(value || 'all')}
              >
                <SelectTrigger className="h-8 w-[130px]">
                  <SelectValue>
                    {(value: string) =>
                      value === 'all'
                        ? m['admin.user_detail.status_all']()
                        : tDynamic(`admin.payments.status_${value}`)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {m['admin.user_detail.status_all']()}
                  </SelectItem>
                  {ORDER_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tDynamic(`admin.payments.status_${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={paymentType}
                onValueChange={(value) => setPaymentType(value || 'all')}
              >
                <SelectTrigger className="h-8 w-[130px]">
                  <SelectValue>
                    {(value: string) => {
                      const type = ORDER_TYPES.find(([v]) => v === value);
                      return type
                        ? tDynamic(`settings.payments.tab_${type[1]}`)
                        : m['admin.user_detail.type_all']();
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {m['admin.user_detail.type_all']()}
                  </SelectItem>
                  {ORDER_TYPES.map(([value, key]) => (
                    <SelectItem key={value} value={value}>
                      {tDynamic(`settings.payments.tab_${key}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
          onRefresh={() => query.refetch()}
          loading={query.isFetching || query.isPending}
        />
      </CardContent>
    </Card>
  );
}

function UserCredits({ userId }: { userId: string }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const [transactionType, setTransactionType] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [status, transactionType, debouncedSearch]);

  const query = useQuery({
    queryKey: [
      'admin-user-credits',
      userId,
      page,
      status,
      transactionType,
      debouncedSearch,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        userId,
        page: String(page),
        pageSize: String(PAGE_SIZE),
        // The endpoint defaults to active records; 'all' lifts that filter.
        status,
      });
      if (transactionType !== 'all')
        params.set('transactionType', transactionType);
      if (debouncedSearch) params.set('search', debouncedSearch);
      return apiGet<PageResult<Credit>>(`/api/admin/credits?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const columns: Column<Credit>[] = [
    {
      header: m['admin.credits.transaction_no'](),
      cell: (c) => <span className="font-mono text-xs">{c.transactionNo}</span>,
    },
    {
      header: m['admin.credits.amount'](),
      cell: (c) => (
        <span
          className={cn(
            'font-medium tabular-nums',
            c.credits > 0 ? 'text-green-600' : 'text-red-500'
          )}
        >
          {c.credits > 0 ? `+${c.credits}` : c.credits}
        </span>
      ),
    },
    {
      header: m['admin.credits.remaining'](),
      cell: (c) =>
        c.transactionType === 'grant' ? c.remainingCredits : <Empty />,
    },
    {
      header: m['admin.payments.status'](),
      cell: (c) => (
        <Badge variant={c.status === 'active' ? 'default' : 'secondary'}>
          {tDynamic(`admin.user_detail.credit_status_${c.status}`)}
        </Badge>
      ),
    },
    {
      header: m['admin.credits.type'](),
      cell: (c) => tDynamic(`admin.user_detail.tab_${c.transactionType}`),
    },
    {
      header: m['admin.credits.scene'](),
      cell: (c) => c.transactionScene || '—',
    },
    {
      header: m['admin.credits.description'](),
      cell: (c) => (
        <span className="text-muted-foreground block max-w-[240px] truncate text-sm">
          {c.description || '—'}
        </span>
      ),
    },
    {
      header: m['admin.credits.expires_at'](),
      cell: (c) => (
        <span className="text-muted-foreground text-sm">
          {c.expiresAt ? formatDateTime(c.expiresAt) : '—'}
        </span>
      ),
    },
    {
      header: m['admin.credits.created_at'](),
      cell: (c) => (
        <span className="text-muted-foreground text-sm">
          {formatDateTime(c.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m['admin.user_detail.credits_title']()}</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={query.data?.items ?? []}
          total={query.data?.total ?? 0}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          rowKey={(c) => c.id}
          emptyText={m['admin.credits.no_credits']()}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder={m['admin.user_detail.credit_search']()}
          toolbar={
            <div className="flex gap-2">
              <Select
                value={status}
                onValueChange={(value) => setStatus(value || 'all')}
              >
                <SelectTrigger className="h-8 w-[130px]">
                  <SelectValue>
                    {(value: string) =>
                      value === 'all'
                        ? m['admin.user_detail.status_all']()
                        : tDynamic(`admin.user_detail.credit_status_${value}`)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {m['admin.user_detail.status_all']()}
                  </SelectItem>
                  {CREDIT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tDynamic(`admin.user_detail.credit_status_${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={transactionType}
                onValueChange={(value) => setTransactionType(value || 'all')}
              >
                <SelectTrigger className="h-8 w-[130px]">
                  <SelectValue>
                    {(value: string) =>
                      value === 'all'
                        ? m['admin.user_detail.type_all']()
                        : tDynamic(`admin.user_detail.tab_${value}`)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {m['admin.user_detail.type_all']()}
                  </SelectItem>
                  {CREDIT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {tDynamic(`admin.user_detail.tab_${t}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
          onRefresh={() => query.refetch()}
          loading={query.isFetching || query.isPending}
        />
      </CardContent>
    </Card>
  );
}

export const Route = createFileRoute('/admin/users_/$id')({
  component: UserDetailPage,
});
