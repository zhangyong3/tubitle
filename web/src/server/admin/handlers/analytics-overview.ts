import { getOverviewStats } from '@/modules/analytics/service';
import { respData, respErr } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

export async function GET(_context: AdminHandlerContext) {
  try {
    return respData(await getOverviewStats());
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
