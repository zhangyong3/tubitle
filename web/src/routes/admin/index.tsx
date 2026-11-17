import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { DollarSign, LifeBuoy, Repeat, Users } from 'lucide-react';

import { apiGet } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { ConversionFunnel } from './-conversion-funnel';

interface OverviewStats {
  users: { total: number; new24h: number };
  revenue30d: { currency: string; amount: number; orders: number }[];
  subscriptions: { active: number; trialing: number };
  openTickets: number;
}

// Amounts are in minor units; derive the divisor from the currency itself so
// zero-decimal currencies (JPY, KRW…) aren't divided by 100.
function formatMoney(amount: number, currency: string) {
  try {
    const fmt = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    });
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
    return fmt.format(amount / 10 ** digits);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function AdminPage() {
  const query = useQuery({
    queryKey: ['admin-overview-stats'],
    queryFn: () => apiGet<OverviewStats>('/api/admin/analytics/overview'),
  });
  const stats = query.data;
  const [mainRevenue, ...otherRevenue] = stats?.revenue30d ?? [];
  const payments = (stats?.revenue30d ?? []).reduce((n, r) => n + r.orders, 0);
  const pending = '—';

  const cards = [
    {
      title: m['admin.stats.total_users'](),
      icon: Users,
      value: stats ? stats.users.total.toLocaleString() : pending,
      hint: stats
        ? m['admin.stats.new_24h']({ count: stats.users.new24h })
        : null,
    },
    {
      title: m['admin.stats.revenue_30d'](),
      icon: DollarSign,
      value: stats
        ? mainRevenue
          ? formatMoney(mainRevenue.amount, mainRevenue.currency)
          : formatMoney(0, 'usd')
        : pending,
      hint: stats
        ? [
            m['admin.stats.payments_net']({ count: payments }),
            ...otherRevenue.map(
              (r) => `+ ${formatMoney(r.amount, r.currency)}`
            ),
          ].join(' · ')
        : null,
    },
    {
      title: m['admin.stats.active_subscriptions'](),
      icon: Repeat,
      value: stats ? stats.subscriptions.active.toLocaleString() : pending,
      hint: stats
        ? m['admin.stats.trialing']({ count: stats.subscriptions.trialing })
        : null,
    },
    {
      title: m['admin.stats.open_tickets'](),
      icon: LifeBuoy,
      value: stats ? stats.openTickets.toLocaleString() : pending,
      hint: stats ? m['admin.stats.open_tickets_hint']() : null,
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{m['admin.title']()}</h1>
        <p className="text-muted-foreground">{m['admin.description']()}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {card.title}
              </CardTitle>
              <card.icon className="text-muted-foreground size-4" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">
                {card.value}
              </div>
              {card.hint && (
                <p className="text-muted-foreground mt-1 text-xs">
                  {card.hint}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <ConversionFunnel />
    </div>
  );
}

export const Route = createFileRoute('/admin/')({
  component: AdminPage,
});
