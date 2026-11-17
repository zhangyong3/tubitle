import { count, desc, eq } from 'drizzle-orm';

import { db } from '@/core/db';
import { user } from '@/config/db/schema';
import { respData, respErr } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

const MAX_OPTIONS = 50;

/** Most common sign-up utm_source values across all users, with counts. */
export async function GET(_context: AdminHandlerContext) {
  try {
    const rows = await db()
      .select({ value: user.utmSource, count: count() })
      .from(user)
      .where(eq(user.type, 'user'))
      .groupBy(user.utmSource)
      .orderBy(desc(count()))
      .limit(MAX_OPTIONS);
    return respData(rows);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
