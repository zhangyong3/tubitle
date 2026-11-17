/**
 * Optional user-center pages an admin switches at Settings → Users → User
 * Features. Shared by the server (API routes refuse a feature that is off)
 * and the browser (nav entries, widgets), so both use the same default while
 * the setting has never been saved.
 */
export const USER_FEATURES = {
  credits_enabled: false,
  billing_enabled: false,
  payments_enabled: false,
  /** API Keys page. Off until the project actually offers an API. */
  apikeys_enabled: false,
  /** Support tickets: the page and the floating support button. */
  tickets_enabled: true,
} as const;

export type UserFeature = keyof typeof USER_FEATURES;

export function isUserFeatureOn(
  configs: Record<string, string | undefined> | undefined,
  feature: UserFeature
): boolean {
  const value = configs?.[feature];
  return value ? value === 'true' : USER_FEATURES[feature];
}
