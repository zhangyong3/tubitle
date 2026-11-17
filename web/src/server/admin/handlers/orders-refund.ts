import { refundOrder } from '@/modules/payment/service';
import { respData, respErr } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

export async function POST({ request, actor }: AdminHandlerContext) {
  try {
    const { orderNo, reason, deductCredits, cancelSubscription } =
      await request.json();
    if (!orderNo) return respErr('orderNo is required');

    const result = await refundOrder({
      orderNo,
      operatorId: actor.userId,
      reason,
      deductCredits,
      cancelSubscription,
    });
    return respData(result);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
