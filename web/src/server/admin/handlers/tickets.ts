import { listAllTickets, type TicketStatus } from '@/modules/tickets/service';
import { respErr, respPage } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

const VALID_STATUSES: TicketStatus[] = ['open', 'replied', 'closed'];

export async function GET({ request, actor }: AdminHandlerContext) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('pageSize') || '20'))
    );
    const status = searchParams.get('status') as TicketStatus | null;
    const search = searchParams.get('keyword') || undefined;

    const { items, total } = await listAllTickets({
      page,
      pageSize,
      status: status && VALID_STATUSES.includes(status) ? status : undefined,
      search,
    });
    return respPage(items, total);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
