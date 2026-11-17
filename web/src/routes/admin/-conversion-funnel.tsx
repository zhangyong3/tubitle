import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CreditCard, RefreshCw, ShoppingCart, UserPlus, X } from 'lucide-react';

import { apiGet } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const RANGES = ['24h', '7d', '30d'] as const;
type Range = (typeof RANGES)[number];

const DIMENSIONS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'referrer',
  'country',
] as const;
type Dimension = (typeof DIMENSIONS)[number];

interface Counts {
  signups: number;
  checkouts: number;
  paid: number;
}
interface FunnelReport {
  since: string;
  totals: Counts;
  groupBy: Dimension;
  rows: (Counts & { value: string })[];
  options: Record<Dimension, string[]>;
}

// Select values can't be '' — sentinels for "no filter" and "untagged".
const ANY = '__any__';
const NONE = '__none__';

function rate(part: number, whole: number) {
  if (!whole) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/** Signup → checkout → paid funnel section for the admin overview. */
export function ConversionFunnel() {
  const [range, setRange] = useState<Range>('7d');
  const [groupBy, setGroupBy] = useState<Dimension>('utm_source');
  const [filters, setFilters] = useState<Partial<Record<Dimension, string>>>(
    {}
  );

  const query = useQuery({
    queryKey: ['admin-analytics-funnel', range, groupBy, filters],
    queryFn: () => {
      const params = new URLSearchParams({ range, groupBy });
      for (const [dim, value] of Object.entries(filters)) {
        if (value !== undefined) params.set(dim, value);
      }
      return apiGet<FunnelReport>(`/api/admin/analytics/funnel?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const report = query.data;
  const totals = report?.totals ?? { signups: 0, checkouts: 0, paid: 0 };
  const hasFilters = Object.keys(filters).length > 0;
  const untagged = m['admin.analytics.untagged']();

  function dimLabel(dim: Dimension) {
    return dim === 'referrer'
      ? m['admin.analytics.dim_referrer']()
      : dim === 'country'
        ? m['admin.analytics.dim_country']()
        : dim;
  }

  function setFilter(dim: Dimension, value: string | undefined) {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[dim];
      else next[dim] = value;
      return next;
    });
  }

  const steps = [
    {
      label: m['admin.analytics.signups'](),
      value: totals.signups,
      hint: null,
      icon: UserPlus,
    },
    {
      label: m['admin.analytics.checkouts'](),
      value: totals.checkouts,
      hint: m['admin.analytics.of_signups']({
        rate: rate(totals.checkouts, totals.signups),
      }),
      icon: ShoppingCart,
    },
    {
      label: m['admin.analytics.paid'](),
      value: totals.paid,
      hint: `${m['admin.analytics.of_checkouts']({
        rate: rate(totals.paid, totals.checkouts),
      })} · ${m['admin.analytics.of_signups']({
        rate: rate(totals.paid, totals.signups),
      })}`,
      icon: CreditCard,
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">
            {m['admin.analytics.title']()}
          </h2>
          <p className="text-muted-foreground text-sm">
            {m['admin.analytics.description']()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-muted inline-flex rounded-lg p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                  range === r
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {r === '24h'
                  ? m['admin.analytics.range_24h']()
                  : r === '7d'
                    ? m['admin.analytics.range_7d']()
                    : m['admin.analytics.range_30d']()}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => query.refetch()}
            aria-label={m['admin.analytics.refresh']()}
          >
            <RefreshCw
              className={cn('size-4', query.isFetching && 'animate-spin')}
            />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {DIMENSIONS.map((dim) => {
          const options = report?.options[dim] ?? [];
          const current = filters[dim];
          // Keep the active value selectable even if it fell out of the top list.
          const values =
            current !== undefined && !options.includes(current)
              ? [current, ...options]
              : options;
          const items = [
            {
              value: ANY,
              label: `${dimLabel(dim)}: ${m['admin.analytics.any']()}`,
            },
            ...values.map((v) => ({
              value: v || NONE,
              label: `${dimLabel(dim)}: ${v || untagged}`,
            })),
          ];
          return (
            <Select
              key={dim}
              items={items}
              value={current === undefined ? ANY : current || NONE}
              onValueChange={(v) =>
                setFilter(
                  dim,
                  !v || v === ANY ? undefined : v === NONE ? '' : String(v)
                )
              }
            >
              <SelectTrigger
                className={cn(
                  'max-w-60',
                  current !== undefined && 'border-primary'
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
            <X className="size-4" />
            {m['admin.analytics.clear_filters']()}
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((step) => (
          <Card key={step.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {step.label}
              </CardTitle>
              <step.icon className="text-muted-foreground size-4" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">
                {step.value.toLocaleString()}
              </div>
              {step.hint && (
                <p className="text-muted-foreground mt-1 text-xs">
                  {step.hint}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">
            {m['admin.analytics.breakdown']()}
          </CardTitle>
          <Select
            items={DIMENSIONS.map((d) => ({
              value: d,
              label: `${m['admin.analytics.group_by']()}: ${dimLabel(d)}`,
            }))}
            value={groupBy}
            onValueChange={(v) => v && setGroupBy(v as Dimension)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIMENSIONS.map((d) => (
                <SelectItem key={d} value={d}>
                  {`${m['admin.analytics.group_by']()}: ${dimLabel(d)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{dimLabel(groupBy)}</TableHead>
                  <TableHead className="text-right">
                    {m['admin.analytics.signups']()}
                  </TableHead>
                  <TableHead className="text-right">
                    {m['admin.analytics.checkouts']()}
                  </TableHead>
                  <TableHead className="text-right">
                    {m['admin.analytics.checkout_rate']()}
                  </TableHead>
                  <TableHead className="text-right">
                    {m['admin.analytics.paid']()}
                  </TableHead>
                  <TableHead className="text-right">
                    {m['admin.analytics.paid_rate']()}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody
                className={cn(
                  query.isFetching && 'opacity-60 transition-opacity'
                )}
              >
                {(report?.rows ?? []).map((row) => (
                  <TableRow key={row.value}>
                    <TableCell className="max-w-80">
                      <button
                        className="hover:text-primary truncate text-left underline-offset-4 hover:underline"
                        title={m['admin.analytics.filter_by_value']()}
                        onClick={() => setFilter(groupBy, row.value)}
                      >
                        {row.value || (
                          <span className="text-muted-foreground">
                            {untagged}
                          </span>
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.signups}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.checkouts}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {rate(row.checkouts, row.signups)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.paid}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {rate(row.paid, row.signups)}
                    </TableCell>
                  </TableRow>
                ))}
                {report && report.rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-muted-foreground h-24 text-center"
                    >
                      <p>{m['admin.analytics.empty']()}</p>
                      <p className="mt-1 text-xs">
                        {m['admin.analytics.empty_hint']()}
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground mt-4 text-xs">
            {m['admin.analytics.footnote']()}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
