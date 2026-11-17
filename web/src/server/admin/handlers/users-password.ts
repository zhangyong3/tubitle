import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';

import { db } from '@/core/db';
import { atomic } from '@/core/db/atomic';
import { account, session, user, userRole } from '@/config/db/schema';
import { getUuid } from '@/lib/hash';
import { respErr, respOk } from '@/lib/resp';

import { beyondCeiling, roleCodes } from '../ceiling';
import type { AdminHandlerContext } from '../types';

/**
 * Set a user's sign-in password. Signs the user out everywhere. Users who
 * only signed in with OAuth get an email/password login added.
 */
export async function POST({ request, actor }: AdminHandlerContext) {
  try {
    // A password lets whoever holds it act as that user; keep it to people.
    if (actor.tokenId)
      return respErr('Passwords can only be set from the admin console', {
        status: 403,
      });

    const { userId, password } = (await request.json()) as {
      userId?: string;
      password?: string;
    };
    if (!userId) return respErr('Missing userId');
    if (typeof password !== 'string' || password.length < 8)
      return respErr('Password must be at least 8 characters');
    if (password.length > 128)
      return respErr('Password must be at most 128 characters');

    const [target] = await db()
      .select({ id: user.id, type: user.type })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!target) return respErr('User not found');
    if (target.type === 'api')
      return respErr('Agent accounts sign in with API keys, not passwords');

    // Taking over an account is as good as holding its roles.
    const roles: { roleId: string }[] = await db()
      .select({ roleId: userRole.roleId })
      .from(userRole)
      .where(eq(userRole.userId, userId));
    const denied = beyondCeiling(
      actor,
      await roleCodes(roles.map((r) => r.roleId))
    );
    if (denied) return denied;

    const [credential] = await db()
      .select({ id: account.id })
      .from(account)
      .where(
        and(eq(account.userId, userId), eq(account.providerId, 'credential'))
      )
      .limit(1);
    const hash = await hashPassword(password);
    const now = new Date();

    await atomic((q) => [
      credential
        ? q
            .update(account)
            .set({ password: hash, updatedAt: now })
            .where(eq(account.id, credential.id))
        : q.insert(account).values({
            id: getUuid(),
            accountId: userId,
            providerId: 'credential',
            userId,
            password: hash,
            createdAt: now,
            updatedAt: now,
          }),
      q.delete(session).where(eq(session.userId, userId)),
    ]);

    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
