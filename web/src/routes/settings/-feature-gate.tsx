import type { ReactNode } from 'react';
import { Navigate } from '@tanstack/react-router';

import {
  useUserFeatures,
  type UserFeatureKey,
} from '@/hooks/use-user-features';

/**
 * Renders a user-center page only while an admin has it switched on;
 * otherwise sends the user to the overview. Redirect rather than a notice,
 * because payment flows land on these pages (success → payments, cancel →
 * billing).
 */
export function FeatureGate({
  feature,
  children,
}: {
  feature: UserFeatureKey;
  children: ReactNode;
}) {
  const features = useUserFeatures();
  if (!features.loaded) return null;
  if (!features[feature]) return <Navigate to="/settings" replace />;
  return children;
}
