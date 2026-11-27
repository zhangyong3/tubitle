import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import { getPricingProduct, PRO_MONTHLY_PRODUCT_ID } from '@/config/pricing';
import { apiGet, apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Membership = {
  plan: 'free' | 'pro';
  analysisDaily: number;
  libraryDaily: number | null;
  libraryTotal: number | null;
  pdfEnabled: boolean;
  checkoutAvailable: boolean;
  subscription: {
    status: string;
    currentPeriodEnd: string;
    subscriptionNo: string;
  } | null;
};

function MembershipPage() {
  const [cancelOpen, setCancelOpen] = useState(false);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['membership'],
    queryFn: () => apiGet<Membership>('/api/user/membership'),
    refetchInterval: 15000,
  });
  const checkout = useMutation({
    mutationFn: () =>
      apiPost<{ checkout_url: string }>('/api/payment/checkout', {
        product_id: PRO_MONTHLY_PRODUCT_ID,
        payment_provider: 'waffo',
        redirect: '/settings/membership',
        locale: getLocale(),
      }),
    onSuccess: ({ checkout_url }) => {
      window.location.assign(checkout_url);
    },
    onError: () => toast.error(m['tubitle.membership.checkoutError']()),
  });
  const cancel = useMutation({
    mutationFn: () =>
      apiPost('/api/user/subscriptions/cancel', {
        subscriptionNo: query.data!.subscription!.subscriptionNo,
      }),
    onSuccess: () => {
      setCancelOpen(false);
      queryClient.invalidateQueries({ queryKey: ['membership'] });
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      toast.success(m['settings.billing.cancel_success']());
    },
    onError: () => toast.error(m['settings.billing.cancel_failed']()),
  });
  const member = query.data;
  const price = new Intl.NumberFormat(getLocale(), {
    style: 'currency',
    currency: 'USD',
  }).format(getPricingProduct(PRO_MONTHLY_PRODUCT_ID)!.priceInCents / 100);
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6 md:p-8">
      <h1 className="text-2xl font-semibold">
        {m['tubitle.membership.title']()}
      </h1>
      {query.isPending ? (
        <p role="status">{m['tubitle.membership.loading']()}</p>
      ) : query.isError ? (
        <div role="alert">
          <p>{m['tubitle.membership.loadError']()}</p>
          <Button onClick={() => query.refetch()}>
            {m['tubitle.membership.retry']()}
          </Button>
        </div>
      ) : (
        member && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>
                  {member.plan === 'pro' ? 'Pro' : m['tubitle.pricing.free']()}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {member.subscription && (
                  <p>
                    {member.subscription.status === 'pending_cancel'
                      ? m['tubitle.membership.expires']()
                      : m['tubitle.membership.paidThrough']()}{' '}
                    {new Intl.DateTimeFormat(getLocale(), {
                      dateStyle: 'medium',
                    }).format(new Date(member.subscription.currentPeriodEnd))}
                  </p>
                )}
                <ul className="list-disc space-y-2 pl-5">
                  <li>
                    {m['tubitle.membership.analysis']({
                      count: member.analysisDaily,
                    })}
                  </li>
                  <li>
                    {member.plan === 'pro'
                      ? m['tubitle.pricing.pro2']()
                      : m['tubitle.pricing.free2']()}
                  </li>
                  <li>
                    {member.pdfEnabled
                      ? m['tubitle.pricing.pro3']()
                      : m['tubitle.pricing.free4']()}
                  </li>
                </ul>
                {member.subscription?.status === 'active' && (
                  <div>
                    <Button
                      variant="outline"
                      onClick={() => setCancelOpen(true)}
                    >
                      {m['tubitle.membership.cancel']()}
                    </Button>
                  </div>
                )}
                {member.subscription && (
                  <Link href="/settings/billing" className="underline">
                    {m['tubitle.membership.manage']()}
                  </Link>
                )}
              </CardContent>
            </Card>
            {member.plan === 'free' && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    Pro · {price}
                    {m['tubitle.membership.perMonth']()}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p>{m['tubitle.membership.recurring']()}</p>
                  <ul className="list-disc space-y-2 pl-5">
                    <li>{m['tubitle.pricing.pro1']()}</li>
                    <li>{m['tubitle.pricing.pro2']()}</li>
                    <li>{m['tubitle.pricing.pro3']()}</li>
                  </ul>
                  <Button
                    disabled={!member.checkoutAvailable || checkout.isPending}
                    onClick={() => checkout.mutate()}
                  >
                    {checkout.isPending
                      ? m['tubitle.membership.opening']()
                      : member.checkoutAvailable
                        ? m['tubitle.membership.upgrade']()
                        : m['tubitle.membership.unavailable']()}
                  </Button>
                  {!member.checkoutAvailable && (
                    <p className="text-muted-foreground text-sm">
                      {m['tubitle.membership.paymentPending']()}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )
      )}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m['tubitle.membership.cancel']()}</DialogTitle>
            <DialogDescription>
              {m['tubitle.membership.cancelDescription']()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelOpen(false)}
              disabled={cancel.isPending}
            >
              {m['tubitle.membership.keep']()}
            </Button>
            <Button disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              {m['tubitle.membership.confirmCancel']()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export const Route = createFileRoute('/settings/membership')({
  head: () => ({
    meta: [
      { title: m['tubitle.membership.title']() },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  component: MembershipPage,
});
