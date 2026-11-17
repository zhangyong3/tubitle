import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { apiPost } from '@/lib/api-client';
import { getLocale } from '@/paraglide/runtime.js';
import { usePublicConfig } from '@/hooks/use-public-config';
import type { PaymentProvider } from '@/components/payment-provider-modal';

const ALL_PROVIDERS: PaymentProvider[] = [
  'stripe',
  'creem',
  'paypal',
  'alipay',
  'wechat',
];

/**
 * Pay for a guest post draft (which submits it for review): the site's
 * default provider, or a picker when buyers may choose. Spread `pickerProps`
 * onto <PaymentProviderModal>. `resolveId` may save the draft first.
 */
export function useGuestPostCheckout(opts: {
  resolveId: () => Promise<string>;
  onError?: (error: Error) => void;
}) {
  const configQuery = usePublicConfig();
  const configs = configQuery.data ?? {};
  const providers = ALL_PROVIDERS.filter(
    (p) => configs[`${p}_enabled`] === 'true'
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [payingWith, setPayingWith] = useState<PaymentProvider | null>(null);

  const checkout = useMutation({
    mutationFn: async (provider: PaymentProvider) => {
      const id = await opts.resolveId();
      return apiPost<{ checkout_url?: string }>(
        `/api/guest-posts/${id}/checkout`,
        { payment_provider: provider, locale: getLocale() }
      );
    },
    onSuccess: (data) => {
      if (data?.checkout_url) window.location.href = data.checkout_url;
      else setPayingWith(null);
    },
    onError: (error: Error) => {
      setPayingWith(null);
      opts.onError?.(error);
    },
  });

  function startPay(provider: PaymentProvider) {
    setPayingWith(provider);
    checkout.mutate(provider);
  }

  function pay() {
    if (configs.select_payment_enabled === 'true' && providers.length > 1) {
      setPickerOpen(true);
      return;
    }
    startPay(
      (configs.default_payment_provider ||
        providers[0] ||
        'stripe') as PaymentProvider
    );
  }

  return {
    pay,
    pending: checkout.isPending,
    pickerProps: {
      open: pickerOpen,
      onOpenChange: (open: boolean) => {
        setPickerOpen(open);
        if (!open) setPayingWith(null);
      },
      providers: providers.length
        ? providers
        : (['stripe'] as PaymentProvider[]),
      loadingProvider: payingWith,
      onSelect: startPay,
    },
  };
}
