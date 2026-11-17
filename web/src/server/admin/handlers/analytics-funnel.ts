import {
  FUNNEL_DIMENSIONS,
  getFunnelReport,
  type FunnelDimension,
  type FunnelRange,
} from '@/modules/analytics/service';
import { respData, respErr } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

// Input is already validated by the operation schema in lib/admin-operations.
export async function GET({ request }: AdminHandlerContext) {
  try {
    const { searchParams } = new URL(request.url);
    const filters: Partial<Record<FunnelDimension, string>> = {};
    for (const dim of FUNNEL_DIMENSIONS) {
      const value = searchParams.get(dim);
      if (value !== null) filters[dim] = value;
    }
    const report = await getFunnelReport({
      range: (searchParams.get('range') || '7d') as FunnelRange,
      groupBy: (searchParams.get('groupBy') || 'utm_source') as FunnelDimension,
      filters,
    });
    return respData(report);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
