import type { PricingProduct } from '@/config/pricing';
import { hasPermission } from '@/modules/rbac/service';

const CNY_ONLY_PROVIDERS = new Set(['alipay', 'wechat']);

/**
 * What to charge for `product` through the chosen provider. Amounts come only
 * from the catalog: Alipay/WeChat Pay charge the CNY price (never the USD
 * number reread as yuan), and an admin-configured test amount applies to
 * admins only — the buyer picks the provider, so a leftover test amount would
 * otherwise sell everything for a cent.
 */
export async function resolveCharge(params: {
  product: PricingProduct;
  paymentProvider?: string;
  userId: string;
  configs: Record<string, string>;
}): Promise<
  { amount: number; currency: string; providerKey: string } | { error: string }
> {
  const { product, configs } = params;
  const providerKey =
    params.paymentProvider || configs.default_payment_provider || '';
  const testAmountRaw = providerKey
    ? configs[`${providerKey}_test_amount`]
    : undefined;
  const testAmount =
    testAmountRaw && (await hasPermission(params.userId, 'admin.access'))
      ? parseInt(testAmountRaw)
      : 0;

  let basePrice = product.priceInCents;
  let currency = product.currency;
  if (CNY_ONLY_PROVIDERS.has(providerKey) && currency.toLowerCase() !== 'cny') {
    if (!product.cnyPriceInCents || product.cnyPriceInCents <= 0) {
      return { error: `This product is not available via ${providerKey}` };
    }
    basePrice = product.cnyPriceInCents;
    currency = 'cny';
  }
  return {
    amount: testAmount > 0 ? testAmount : basePrice,
    currency,
    providerKey,
  };
}
