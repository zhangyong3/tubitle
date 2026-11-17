import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  or,
  sql,
  sum,
} from 'drizzle-orm';

import { db } from '@/core/db';
import {
  atomic,
  AtomicGuardError,
  guard,
  type AtomicStep,
} from '@/core/db/atomic';
import { credit } from '@/config/db/schema';
import { getSnowId, getUuid } from '@/lib/hash';

// --- Enums ---

export enum CreditStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  DELETED = 'deleted',
}

export enum CreditTransactionType {
  GRANT = 'grant',
  CONSUME = 'consume',
}

export enum CreditTransactionScene {
  PAYMENT = 'payment',
  SUBSCRIPTION = 'subscription',
  RENEWAL = 'renewal',
  GIFT = 'gift',
  REWARD = 'reward',
  REFUND = 'refund',
}

type NewCredit = typeof credit.$inferInsert;

// --- Expiration ---

export function calculateCreditExpirationTime(params: {
  creditsValidDays: number;
  currentPeriodEnd?: Date;
}): Date | null {
  const { creditsValidDays, currentPeriodEnd } = params;

  if (!creditsValidDays || creditsValidDays <= 0) {
    return null; // never expires
  }

  if (currentPeriodEnd) {
    return new Date(currentPeriodEnd.getTime());
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + creditsValidDays);
  return expiresAt;
}

function validCreditConditions(userId: string) {
  const now = new Date();
  return and(
    eq(credit.userId, userId),
    eq(credit.transactionType, CreditTransactionType.GRANT),
    eq(credit.status, CreditStatus.ACTIVE),
    gt(credit.remainingCredits, 0),
    or(isNull(credit.expiresAt), gt(credit.expiresAt, now))
  );
}

// --- Balance ---

export async function getBalance(userId: string): Promise<number> {
  const [result] = await db()
    .select({ total: sum(credit.remainingCredits) })
    .from(credit)
    .where(validCreditConditions(userId));

  return parseInt(result?.total || '0');
}

// --- Grant ---

export async function grant(params: {
  userId: string;
  userEmail?: string;
  credits: number;
  description?: string;
  orderNo?: string;
  subscriptionNo?: string;
  scene?: string;
  expiresAt?: Date | null;
}) {
  const newCredit: NewCredit = {
    id: getUuid(),
    userId: params.userId,
    userEmail: params.userEmail || '',
    transactionNo: getSnowId(),
    transactionType: CreditTransactionType.GRANT,
    transactionScene: params.scene || CreditTransactionScene.GIFT,
    credits: params.credits,
    remainingCredits: params.credits,
    status: CreditStatus.ACTIVE,
    description: params.description || 'Grant credit',
    orderNo: params.orderNo || '',
    subscriptionNo: params.subscriptionNo || '',
    expiresAt: params.expiresAt !== undefined ? params.expiresAt : null,
  };

  await db().insert(credit).values(newCredit);
  return newCredit;
}

// --- Consume (FIFO) ---

/**
 * Guards: none of these grants went negative (a concurrent spend got there
 * first). Chunked because D1 binds at most 100 parameters per statement.
 */
function grantsStayNonNegative(ids: string[]) {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 90) chunks.push(ids.slice(i, i + 90));
  return chunks.map((chunk) =>
    guard({
      table: credit,
      column: 'userId',
      where: inArray(credit.id, chunk),
      require: gte(credit.remainingCredits, 0),
      message: 'Insufficient credits',
    })
  );
}

/**
 * Plan a FIFO consumption without writing anything: returns the steps for
 * `atomic()` (so callers can bundle them with their own writes, as ai-tasks
 * does) plus the consumption record, or null when the balance is too low.
 * Decrements are relative and followed by a non-negative guard, so a
 * concurrent spend makes the whole atomic write fail instead of overdrawing.
 */
export async function planConsume(params: {
  userId: string;
  userEmail?: string;
  credits: number;
  scene?: string;
  description?: string;
  metadata?: string;
}): Promise<{
  consumedCredit: NewCredit;
  steps: (q: any) => AtomicStep[];
} | null> {
  const {
    userId,
    userEmail,
    credits: amount,
    scene,
    description,
    metadata,
  } = params;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Credits to consume must be a positive integer');
  }

  const grants: (typeof credit.$inferSelect)[] = await db()
    .select()
    .from(credit)
    .where(validCreditConditions(userId))
    .orderBy(asc(credit.expiresAt))
    .limit(10_000);

  let remainingToConsume = amount;
  const consumedItems: {
    creditId: string;
    transactionNo: string;
    creditsConsumed: number;
    creditsBefore: number;
    creditsAfter: number;
  }[] = [];
  for (const item of grants) {
    if (remainingToConsume <= 0) break;
    const toConsume = Math.min(remainingToConsume, item.remainingCredits);
    consumedItems.push({
      creditId: item.id,
      transactionNo: item.transactionNo,
      creditsConsumed: toConsume,
      creditsBefore: item.remainingCredits,
      creditsAfter: item.remainingCredits - toConsume,
    });
    remainingToConsume -= toConsume;
  }
  if (remainingToConsume > 0) return null;

  const consumedCredit: NewCredit = {
    id: getUuid(),
    userId,
    userEmail: userEmail || '',
    transactionNo: getSnowId(),
    transactionType: CreditTransactionType.CONSUME,
    transactionScene: scene || '',
    status: CreditStatus.ACTIVE,
    description: description || '',
    credits: -amount,
    remainingCredits: 0,
    consumedDetail: JSON.stringify(consumedItems),
    metadata: metadata || '',
  };

  return {
    consumedCredit,
    steps: (q) => [
      ...consumedItems.map((item) =>
        q
          .update(credit)
          .set({
            remainingCredits: sql`${credit.remainingCredits} - ${item.creditsConsumed}`,
          })
          .where(eq(credit.id, item.creditId))
      ),
      ...grantsStayNonNegative(consumedItems.map((i) => i.creditId)),
      q.insert(credit).values(consumedCredit),
    ],
  };
}

/** Retries when a concurrent spend wins the race, then gives up as insufficient. */
export async function consume(params: {
  userId: string;
  userEmail?: string;
  credits: number;
  scene?: string;
  description?: string;
  metadata?: string;
}): Promise<{ success: boolean; consumedCredit?: NewCredit }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const plan = await planConsume(params);
    if (!plan) return { success: false };
    try {
      await atomic(plan.steps);
      return { success: true, consumedCredit: plan.consumedCredit };
    } catch (error) {
      if (!(error instanceof AtomicGuardError)) throw error;
    }
  }
  return { success: false };
}

// --- Deduct for a refunded order ---

/**
 * Plan clawing back up to `credits` for a refunded order. Takes the order's
 * own unspent grant first, then other valid grants (FIFO). Never drives the
 * balance below zero — `deducted` is how many credits will actually come off.
 */
export async function planDeductForRefund(params: {
  userId: string;
  userEmail?: string;
  orderNo: string;
  credits: number;
  description?: string;
}): Promise<{ deducted: number; steps: (q: any) => AtomicStep[] }> {
  const { userId, userEmail, orderNo, credits: amount, description } = params;
  if (!amount || amount <= 0) return { deducted: 0, steps: () => [] };

  const grants: (typeof credit.$inferSelect)[] = await db()
    .select()
    .from(credit)
    .where(validCreditConditions(userId))
    .orderBy(
      sql`case when ${credit.orderNo} = ${orderNo} then 0 else 1 end`,
      asc(credit.expiresAt)
    );

  let remainingToDeduct = amount;
  const consumedItems: {
    creditId: string;
    transactionNo: string;
    creditsConsumed: number;
    creditsBefore: number;
    creditsAfter: number;
  }[] = [];
  for (const item of grants) {
    if (remainingToDeduct <= 0) break;
    const toDeduct = Math.min(remainingToDeduct, item.remainingCredits);
    consumedItems.push({
      creditId: item.id,
      transactionNo: item.transactionNo,
      creditsConsumed: toDeduct,
      creditsBefore: item.remainingCredits,
      creditsAfter: item.remainingCredits - toDeduct,
    });
    remainingToDeduct -= toDeduct;
  }

  const deducted = amount - remainingToDeduct;
  if (deducted === 0) return { deducted: 0, steps: () => [] };

  return {
    deducted,
    steps: (q) => [
      ...consumedItems.map((item) =>
        q
          .update(credit)
          .set({
            remainingCredits: sql`${credit.remainingCredits} - ${item.creditsConsumed}`,
          })
          .where(eq(credit.id, item.creditId))
      ),
      ...grantsStayNonNegative(consumedItems.map((i) => i.creditId)),
      q.insert(credit).values({
        id: getUuid(),
        userId,
        userEmail: userEmail || '',
        orderNo,
        transactionNo: getSnowId(),
        transactionType: CreditTransactionType.CONSUME,
        transactionScene: CreditTransactionScene.REFUND,
        status: CreditStatus.ACTIVE,
        description: description || 'Refund deduct',
        credits: -deducted,
        remainingCredits: 0,
        consumedDetail: JSON.stringify(consumedItems),
      } satisfies NewCredit),
    ],
  };
}

// --- Revoke (restore credits from a consumed record) ---

export async function revoke(consumeCreditId: string) {
  const [consumeRecord] = await db()
    .select()
    .from(credit)
    .where(
      and(
        eq(credit.id, consumeCreditId),
        eq(credit.transactionType, CreditTransactionType.CONSUME),
        eq(credit.status, CreditStatus.ACTIVE)
      )
    )
    .limit(1);

  if (!consumeRecord || !consumeRecord.consumedDetail) return;

  const items: { creditId: string; creditsConsumed: number }[] = JSON.parse(
    consumeRecord.consumedDetail
  );

  try {
    await atomic((q) => [
      // Claim the consumption record first: a retried or concurrent revoke
      // (e.g. a provider's failure callback delivered twice) must restore once.
      guard({
        table: credit,
        column: 'userId',
        where: eq(credit.id, consumeCreditId),
        require: eq(credit.status, CreditStatus.ACTIVE),
        message: 'Already revoked',
      }),
      q
        .update(credit)
        .set({ status: CreditStatus.DELETED })
        .where(eq(credit.id, consumeCreditId)),
      // Atomic increment per source grant — no read-modify-write race.
      ...items.map((item) =>
        q
          .update(credit)
          .set({
            remainingCredits: sql`${credit.remainingCredits} + ${item.creditsConsumed}`,
          })
          .where(eq(credit.id, item.creditId))
      ),
    ]);
  } catch (error) {
    if (error instanceof AtomicGuardError) return; // already revoked
    throw error;
  }
}

// --- Auto-grant for new user ---

export async function grantForNewUser(params: {
  userId: string;
  userEmail?: string;
  configs: Record<string, string>;
}) {
  const { userId, userEmail, configs } = params;

  if (configs.initial_credits_enabled !== 'true') return;

  const credits = parseInt(configs.initial_credits_amount) || 0;
  if (credits <= 0) return;

  const validDays = parseInt(configs.initial_credits_valid_days) || 0;
  const description = configs.initial_credits_description || 'Initial credits';

  const expiresAt = calculateCreditExpirationTime({
    creditsValidDays: validDays,
  });

  return grant({
    userId,
    userEmail,
    credits,
    description,
    scene: CreditTransactionScene.GIFT,
    expiresAt,
  });
}

// --- History ---

export async function getHistory(userId: string, limit = 50) {
  return db()
    .select()
    .from(credit)
    .where(and(eq(credit.userId, userId), isNull(credit.deletedAt)))
    .orderBy(desc(credit.createdAt))
    .limit(limit);
}
