import { eq } from 'drizzle-orm';
import { db } from '@/core/db';
import { user } from '@/config/db/schema';
import { normalizeQuotaTimeZone } from './quota-timezone';
export async function userQuotaTimeZone(userId: string): Promise<string> {
  const [account] = await db().select({ timeZone: user.registrationTimeZone }).from(user).where(eq(user.id, userId)).limit(1);
  return normalizeQuotaTimeZone(account?.timeZone);
}
