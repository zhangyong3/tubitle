import { getReport, REPORT_MAX_DAYS } from '@/modules/analytics/service';
import { respData, respErr } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

// Input shape is validated by the operation schema in lib/admin-operations.
export async function GET({ request }: AdminHandlerContext) {
  try {
    const { searchParams } = new URL(request.url);
    const to = searchParams.get('to')
      ? new Date(searchParams.get('to')!)
      : new Date();
    const from = searchParams.get('from')
      ? new Date(searchParams.get('from')!)
      : new Date(to.getTime() - DAY_MS);
    if (from >= to) return respErr('`from` must be before `to`');
    if (to.getTime() - from.getTime() > REPORT_MAX_DAYS * DAY_MS)
      return respErr(`The period can span at most ${REPORT_MAX_DAYS} days`);
    const compare = searchParams.get('compare') !== 'false';
    return respData(await getReport({ from, to, compare }));
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
