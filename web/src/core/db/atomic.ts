import { sql, type SQL } from 'drizzle-orm';

import { envConfigs } from '@/config';

import { db } from './index';

/**
 * Atomic multi-statement writes that work on every backend, D1 included.
 *
 * D1 has no interactive transactions (no BEGIN … read … COMMIT across round
 * trips) — only `batch()`, which commits a fixed list of statements all or
 * nothing. So an atomic write is expressed the same way everywhere: read what
 * you need first, build every statement up front, and state each condition
 * that must hold as a `guard` step instead of an `if` between statements.
 *
 * - D1 / SQLite / Turso: the steps run as one `batch()`; a guard that fails
 *   aborts the batch.
 * - Postgres / MySQL: the steps run in order inside a real
 *   transaction; a guard locks the rows it checks (`FOR UPDATE` where
 *   supported) and throws.
 *
 * Either way a failed guard surfaces as `AtomicGuardError` and nothing is
 * written. Guards see every earlier step's writes, so they work both as
 * preconditions (before an update) and postconditions (after a decrement).
 */

export class AtomicGuardError extends Error {}

export interface AtomicGuard {
  kind: 'guard';
  table: any;
  /** Property name of a NOT NULL column on `table` (used to abort a batch). */
  column: string;
  /** Rows to check. */
  where: SQL | undefined;
  /** Must be true for every row `where` selects. */
  require: SQL;
  message: string;
}

export function guard(g: Omit<AtomicGuard, 'kind'>): AtomicGuard {
  return { kind: 'guard', ...g };
}

/** A drizzle query builder (not awaited), a guard, or nothing (skipped). */
export type AtomicStep =
  | AtomicGuard
  | Record<string, any>
  | false
  | null
  | undefined;

let forcedMode: 'batch' | 'transaction' | undefined;
/** Tests: run the D1 code path (batch) against a local libsql database. */
export function setAtomicModeForTests(mode: typeof forcedMode) {
  forcedMode = mode;
}

function mode() {
  if (forcedMode) return forcedMode;
  // SQLite-family drivers all batch atomically; libsql's interactive
  // transactions also fail fast (SQLITE_BUSY) under concurrent writers.
  return ['d1', 'sqlite', 'turso'].includes(envConfigs.database_provider)
    ? 'batch'
    : 'transaction';
}

const isGuard = (s: any): s is AtomicGuard => s?.kind === 'guard';

/**
 * Run `build(q)`'s steps atomically. `q` is the executor to build every
 * statement from (a transaction or the batch-capable db) — never `db()`.
 */
export async function atomic(build: (q: any) => AtomicStep[]): Promise<void> {
  if (mode() === 'transaction') {
    await db().transaction(async (tx: any) => {
      for (const step of build(tx)) {
        if (!step) continue;
        if (isGuard(step)) {
          const rows: { ok: unknown }[] = await tx
            .select({
              ok: sql`case when ${step.require} then 1 else 0 end`,
            })
            .from(step.table)
            .where(step.where)
            .for('update');
          if (rows.some((r) => Number(r.ok) !== 1))
            throw new AtomicGuardError(step.message);
        } else {
          await step;
        }
      }
    });
    return;
  }

  // Batch: a guard becomes an UPDATE that nulls a NOT NULL column on any row
  // failing the condition — a constraint error that rolls the batch back.
  const q = db();
  const steps = build(q).filter(Boolean) as Exclude<
    AtomicStep,
    false | null | undefined
  >[];
  const guards = steps.filter(isGuard);
  const statements = steps.map((step) => {
    if (!isGuard(step)) return step;
    const column = step.table[step.column];
    return q
      .update(step.table)
      .set({
        [step.column]: sql`case when ${step.require} then ${column} else null end`,
      })
      .where(step.where);
  });
  if (!statements.length) return;
  try {
    await q.batch(statements);
  } catch (error) {
    const text = errorText(error);
    const failed = guards.find((g) =>
      text.includes(
        `NOT NULL constraint failed: ${tableName(g.table)}.${g.table[g.column].name}`
      )
    );
    if (failed) throw new AtomicGuardError(failed.message);
    throw error;
  }
}

function tableName(table: any): string {
  return table[Symbol.for('drizzle:Name')];
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  let e: any = error;
  for (let i = 0; e && i < 5; i++, e = e.cause)
    parts.push(String(e?.message ?? e));
  return parts.join(' | ');
}
