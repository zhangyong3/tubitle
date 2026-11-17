import { useEffect, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Pencil, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

import { tDynamic } from '@/core/i18n/dynamic';
import { apiGet, apiPatch, apiPost, type PageResult } from '@/lib/api-client';
import { formatDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { DataTable, type Column } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UserCell } from '@/components/user-cell';

const ORDER_STATUSES = [
  'pending',
  'created',
  'paid',
  'failed',
  'refunded',
  'deleted',
] as const;

// Filter-only: `refunding` is set by an in-flight refund, never by hand.
const FILTER_STATUSES = [...ORDER_STATUSES, 'refunding'] as const;

interface RefundResult {
  refundStatus: string;
  creditsDeducted: number;
  creditsRequested: number;
  subscriptionError?: string;
}

interface Order {
  id: string;
  orderNo: string;
  userId: string;
  userEmail: string | null;
  status: string;
  amount: number;
  currency: string;
  paymentType: string | null;
  paymentProvider: string;
  productId: string | null;
  productName: string | null;
  description: string | null;
  createdAt: string;
  paidAt: string | null;
  paymentAmount: number | null;
  creditsAmount: number | null;
  subscriptionNo: string | null;
  refundAmount: number | null;
  refundedAt: string | null;
  userName: string | null;
  userImage: string | null;
  userAccountEmail: string | null;
}

const PAGE_SIZE = 20;

const TABS = ['all', 'subscription', 'one_time'] as const;
type Tab = (typeof TABS)[number];

function PaymentsPage() {
  const queryClient = useQueryClient();
  // `?search=` prefills the filter (deep links from payment notifications).
  const initialSearch = Route.useSearch().search ?? '';
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [refundingOrder, setRefundingOrder] = useState<Order | null>(null);
  const [refundCredits, setRefundCredits] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundCancelSub, setRefundCancelSub] = useState(true);

  const editForm = useForm({
    defaultValues: {
      status: '',
      productId: '',
      productName: '',
      description: '',
    },
    onSubmit: async ({ value }) => {
      if (!editingOrder) return;
      await editMutation.mutateAsync({
        orderNo: editingOrder.orderNo,
        status: value.status,
        productId: value.productId || null,
        productName: value.productName || null,
        description: value.description || null,
      });
    },
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [tab, statusFilter, debouncedSearch]);

  const query = useQuery({
    queryKey: ['admin-payments', page, tab, statusFilter, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (tab === 'subscription') params.set('paymentType', 'subscription');
      if (tab === 'one_time') params.set('paymentType', 'one_time');
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      return apiGet<PageResult<Order>>(`/api/admin/orders?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const editMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiPatch('/api/admin/orders', body),
    onSuccess: () => {
      toast.success(m['admin.payments.update_success']());
      setEditingOrder(null);
      queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refundMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiPost<RefundResult>('/api/admin/orders/refund', body),
    onSuccess: (result) => {
      toast.success(
        result.refundStatus === 'pending'
          ? m['admin.payments.refund_pending']({
              credits: result.creditsDeducted,
            })
          : m['admin.payments.refund_success']({
              credits: result.creditsDeducted,
            })
      );
      if (result.creditsDeducted < result.creditsRequested) {
        toast.warning(
          m['admin.payments.refund_credits_short']({
            deducted: result.creditsDeducted,
            requested: result.creditsRequested,
          })
        );
      }
      if (result.subscriptionError) {
        toast.error(
          m['admin.payments.refund_cancel_failed']({
            error: result.subscriptionError,
          })
        );
      }
      setRefundingOrder(null);
      queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
    },
  });

  function openRefund(order: Order) {
    setRefundCredits(String(order.creditsAmount ?? 0));
    setRefundReason('');
    setRefundCancelSub(true);
    setRefundingOrder(order);
  }

  function submitRefund() {
    if (!refundingOrder) return;
    const credits = Number(refundCredits);
    if (!Number.isInteger(credits) || credits < 0) {
      toast.error(m['admin.payments.refund_credits_invalid']());
      return;
    }
    refundMutation.mutate({
      orderNo: refundingOrder.orderNo,
      deductCredits: credits,
      reason: refundReason.trim() || undefined,
      cancelSubscription: !!refundingOrder.subscriptionNo && refundCancelSub,
    });
  }

  const orders = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  function formatAmount(amount: number, currency: string) {
    const value = amount / 100;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(value);
  }

  const statusVariant = (s: string) => {
    if (s === 'paid') return 'default';
    if (s === 'failed') return 'destructive';
    if (s === 'refunded' || s === 'refunding') return 'outline';
    return 'secondary';
  };

  function openEdit(order: Order) {
    editForm.reset({
      status: order.status,
      productId: order.productId || '',
      productName: order.productName || '',
      description: order.description || '',
    });
    setEditingOrder(order);
  }

  const columns: Column<Order>[] = [
    {
      header: m['admin.payments.order_no'](),
      cell: (o) => <span className="font-mono text-xs">{o.orderNo}</span>,
    },
    {
      header: m['admin.payments.user'](),
      cell: (o) => (
        <UserCell
          userId={o.userId}
          name={o.userName}
          email={o.userAccountEmail || o.userEmail}
          image={o.userImage}
        />
      ),
    },
    {
      header: m['admin.payments.amount'](),
      cell: (o) => (
        <div className="flex flex-col">
          <span className="font-medium">
            {formatAmount(o.amount, o.currency)}
          </span>
          {o.refundAmount != null && (
            <span className="text-muted-foreground text-xs">
              {m['admin.payments.refunded_amount']({
                amount: formatAmount(o.refundAmount, o.currency),
              })}
            </span>
          )}
        </div>
      ),
    },
    {
      header: m['admin.payments.status'](),
      cell: (o) => (
        <Badge variant={statusVariant(o.status)}>
          {tDynamic(`admin.payments.status_${o.status}`)}
        </Badge>
      ),
    },
    {
      header: m['admin.payments.type'](),
      cell: (o) => o.paymentType || '—',
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
    {
      header: '',
      className: 'w-[88px]',
      cell: (o) => (
        <div className="flex items-center gap-1">
          {(o.status === 'paid' || o.status === 'refunding') && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title={m['admin.payments.refund']()}
              aria-label={m['admin.payments.refund']()}
              onClick={() => openRefund(o)}
            >
              <Undo2 className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => openEdit(o)}
          >
            <Pencil className="size-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{m['admin.payments.title']()}</h1>
        <p className="text-muted-foreground">
          {m['admin.payments.description']()}
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
            {tDynamic(`admin.payments.tab_${tb}`)}
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
            emptyText={m['admin.payments.no_payments']()}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={m['admin.payments.search_placeholder']()}
            toolbar={
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value || 'all')}
              >
                <SelectTrigger className="h-8 w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {m['admin.payments.tab_all']()}
                  </SelectItem>
                  {FILTER_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {tDynamic(`admin.payments.status_${status}`)}
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

      <Dialog
        open={!!editingOrder}
        onOpenChange={(open) => {
          if (!open && !editMutation.isPending) setEditingOrder(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m['admin.payments.edit_title']()}</DialogTitle>
            <DialogDescription>
              {m['admin.payments.edit_description']()}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              editForm.handleSubmit();
            }}
          >
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>{m['admin.payments.order_no']()}</Label>
                <Input value={editingOrder?.orderNo || ''} disabled />
              </div>
              <editForm.Field name="status">
                {(field) => (
                  <div className="space-y-1.5">
                    <Label>{m['admin.payments.status_label']()}</Label>
                    <Select
                      value={field.state.value}
                      onValueChange={(value) => field.handleChange(value || '')}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {/* Only an unpaid order can be closed by hand; payment
                            states change through checkout and refunds. */}
                        {[
                          editingOrder?.status || '',
                          ...(['created', 'pending'].includes(
                            editingOrder?.status || ''
                          )
                            ? ['failed']
                            : []),
                        ]
                          .filter(Boolean)
                          .map((status) => (
                            <SelectItem key={status} value={status}>
                              {tDynamic(`admin.payments.status_${status}`)}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </editForm.Field>
              {(['productId', 'productName', 'description'] as const).map(
                (name) => (
                  <editForm.Field key={name} name={name}>
                    {(field) => (
                      <div className="space-y-1.5">
                        <Label>
                          {m[
                            `admin.payments.${
                              name === 'productId'
                                ? 'product_id_label'
                                : name === 'productName'
                                  ? 'product_name_label'
                                  : 'product_description_label'
                            }`
                          ]()}
                        </Label>
                        <Input
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                        />
                      </div>
                    )}
                  </editForm.Field>
                )
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={editMutation.isPending}
                onClick={() => setEditingOrder(null)}
              >
                {m['admin.payments.cancel']()}
              </Button>
              <Button type="submit" disabled={editMutation.isPending}>
                {editMutation.isPending
                  ? m['admin.payments.saving']()
                  : m['admin.payments.save']()}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!refundingOrder}
        onOpenChange={(open) => {
          if (!open && !refundMutation.isPending) setRefundingOrder(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m['admin.payments.refund_title']()}</DialogTitle>
            <DialogDescription>
              {m['admin.payments.refund_description']({
                provider: refundingOrder?.paymentProvider || '',
              })}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitRefund();
            }}
          >
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <div className="text-muted-foreground">
                    {m['admin.payments.order_no']()}
                  </div>
                  <div className="font-mono text-xs break-all">
                    {refundingOrder?.orderNo}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground">
                    {m['admin.payments.refund_amount']()}
                  </div>
                  <div className="font-medium">
                    {refundingOrder &&
                      formatAmount(
                        refundingOrder.paymentAmount ?? refundingOrder.amount,
                        refundingOrder.currency
                      )}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="refund-credits">
                  {m['admin.payments.refund_credits_label']()}
                </Label>
                <Input
                  id="refund-credits"
                  type="number"
                  min={0}
                  step={1}
                  value={refundCredits}
                  onChange={(event) => setRefundCredits(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  {m['admin.payments.refund_credits_hint']({
                    credits: refundingOrder?.creditsAmount ?? 0,
                  })}
                </p>
              </div>
              {refundingOrder?.subscriptionNo && (
                <label className="flex cursor-pointer items-center gap-3 text-sm">
                  <Checkbox
                    checked={refundCancelSub}
                    onCheckedChange={(checked) =>
                      setRefundCancelSub(checked === true)
                    }
                  />
                  {m['admin.payments.refund_cancel_subscription']()}
                </label>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="refund-reason">
                  {m['admin.payments.refund_reason_label']()}
                </Label>
                <Input
                  id="refund-reason"
                  value={refundReason}
                  maxLength={500}
                  onChange={(event) => setRefundReason(event.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={refundMutation.isPending}
                onClick={() => setRefundingOrder(null)}
              >
                {m['admin.payments.cancel']()}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={refundMutation.isPending}
              >
                {refundMutation.isPending
                  ? m['admin.payments.refunding']()
                  : m['admin.payments.refund_confirm']()}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const Route = createFileRoute('/admin/payments')({
  validateSearch: (search: Record<string, unknown>): { search?: string } =>
    typeof search.search === 'string' && search.search
      ? { search: search.search }
      : {},
  component: PaymentsPage,
});
