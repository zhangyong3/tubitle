import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { waffoConfigured } from '@/core/payment/waffo';
import {
  ANALYSIS_DAILY_LIMITS,
  LEARNING_FREE_LIMITS,
} from '@/config/learning-plans';
import { getAllConfigs } from '@/modules/config/service';
import { activeProSubscription } from '@/lib/learning-plan';
import { respData, respErr } from '@/lib/resp';

export const Route = createFileRoute('/api/user/membership')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await getAuth().api.getSession({
          headers: request.headers,
        });
        if (!session?.user) return respErr('Unauthorized', { status: 401 });
        const [subscription, configs] = await Promise.all([
          activeProSubscription(session.user.id),
          getAllConfigs(),
        ]);
        const plan = subscription ? 'pro' : 'free';
        return respData(
          {
            plan,
            analysisDaily: ANALYSIS_DAILY_LIMITS[plan],
            libraryDaily: subscription ? null : LEARNING_FREE_LIMITS.daily,
            libraryTotal: subscription ? null : LEARNING_FREE_LIMITS.total,
            pdfEnabled: !!subscription,
            checkoutAvailable: waffoConfigured(configs),
            subscription: subscription
              ? {
                  status: subscription.status,
                  currentPeriodEnd: subscription.currentPeriodEnd,
                  subscriptionNo: subscription.subscriptionNo,
                }
              : null,
          },
          { headers: { 'Cache-Control': 'private, no-store' } }
        );
      },
    },
  },
});
