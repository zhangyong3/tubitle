import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  or,
  type SQL,
} from 'drizzle-orm';

import { db } from '@/core/db';
import { role, user, userRole } from '@/config/db/schema';
import { getBalance } from '@/modules/credits/service';
import { respErr, respPage } from '@/lib/resp';
import { keywordMatch } from '@/lib/sql-search';

import type { AdminHandlerContext } from '../types';

export async function GET({ request, actor }: AdminHandlerContext) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('pageSize') || '20'))
    );
    const offset = (page - 1) * pageSize;
    const search = searchParams.get('search');

    // Agent service accounts are managed on the Agent page, not listed as users.
    const conditions: SQL[] = [eq(user.type, 'user')];
    const keyword = keywordMatch(search, {
      contains: [user.email, user.name],
      exact: [user.id],
    });
    if (keyword) conditions.push(keyword);
    const source = searchParams.get('utm_source');
    // '' is a real value (direct / untagged), so only absent means "any".
    if (source !== null) conditions.push(eq(user.utmSource, source));
    const where = and(...conditions);

    const [totalResult] = await db()
      .select({ count: count() })
      .from(user)
      .where(where);
    const total = totalResult.count;

    const users = await db()
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        createdAt: user.createdAt,
        utmSource: user.utmSource,
        ip: user.ip,
      })
      .from(user)
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(pageSize)
      .offset(offset);

    // Effective roles only — same rule as permission checks (active, unexpired).
    const ids = users.map((u: (typeof users)[number]) => u.id);
    const roleRows = ids.length
      ? await db()
          .select({
            userId: userRole.userId,
            name: role.name,
            title: role.title,
          })
          .from(userRole)
          .innerJoin(role, eq(userRole.roleId, role.id))
          .where(
            and(
              inArray(userRole.userId, ids),
              eq(role.status, 'active'),
              or(isNull(userRole.expiresAt), gt(userRole.expiresAt, new Date()))
            )
          )
      : [];
    const rolesByUser = new Map<string, { name: string; title: string }[]>();
    for (const r of roleRows as {
      userId: string;
      name: string;
      title: string;
    }[]) {
      const list = rolesByUser.get(r.userId) ?? [];
      list.push({ name: r.name, title: r.title });
      rolesByUser.set(r.userId, list);
    }

    const items = await Promise.all(
      users.map(async (u: (typeof users)[number]) => ({
        ...u,
        credits: await getBalance(u.id),
        roles: rolesByUser.get(u.id) ?? [],
      }))
    );

    return respPage(items, total);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
