import { listGuestPosts } from '@/modules/guest-posts/service';
import { respErr, respPage } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

export async function GET({ request }: AdminHandlerContext) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('pageSize') || '20'))
    );
    const { items, total } = await listGuestPosts({
      page,
      pageSize,
      status: searchParams.get('status') || undefined,
      search: searchParams.get('search') || undefined,
    });
    return respPage(items, total);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
