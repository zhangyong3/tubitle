import { isUserFeatureOn } from '@/config/user-features';

import { usePublicConfig } from './use-public-config';

/**
 * Which optional user-center pages are on. `loaded` is false until the
 * public config arrives; until then each one reads as its default.
 */
export function useUserFeatures() {
  const { data, isSuccess } = usePublicConfig();
  return {
    loaded: isSuccess,
    credits: isUserFeatureOn(data, 'credits_enabled'),
    billing: isUserFeatureOn(data, 'billing_enabled'),
    payments: isUserFeatureOn(data, 'payments_enabled'),
    apikeys: isUserFeatureOn(data, 'apikeys_enabled'),
    tickets: isUserFeatureOn(data, 'tickets_enabled'),
  };
}

export type UserFeatureKey = Exclude<
  keyof ReturnType<typeof useUserFeatures>,
  'loaded'
>;
