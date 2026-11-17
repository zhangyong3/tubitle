import { db } from '@/core/db';
import { userEvent } from '@/config/db/schema';
import {
  EVENT_DETAIL_LIMITS,
  getEventDefinition,
  type EventDetail,
  type UserEventKind,
} from '@/config/events';
import { getUuid } from '@/lib/hash';

/**
 * Product events (see src/config/events.ts). The timeline reads them back;
 * there is no update or delete — events are an append-only record.
 */

/** Normalized detail, or an error message. */
export function sanitizeEventDetail(
  input: unknown
): { detail: EventDetail } | { error: string } {
  if (input === undefined || input === null) return { detail: {} };
  if (typeof input !== 'object' || Array.isArray(input))
    return { error: 'detail must be an object' };
  const entries = Object.entries(input as Record<string, unknown>);
  const { maxKeys, maxKeyLength, maxStringLength } = EVENT_DETAIL_LIMITS;
  if (entries.length > maxKeys)
    return { error: `detail allows at most ${maxKeys} keys` };
  const detail: EventDetail = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z0-9_]+$/.test(key) || key.length > maxKeyLength)
      return { error: `invalid detail key: ${key.slice(0, maxKeyLength)}` };
    if (typeof value === 'string') {
      if (value.length > maxStringLength)
        return { error: `detail.${key} is longer than ${maxStringLength}` };
      detail[key] = value;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value))
        return { error: `detail.${key} must be finite` };
      detail[key] = value;
    } else if (typeof value === 'boolean' || value === null) {
      detail[key] = value;
    } else {
      return { error: `detail.${key} must be a string, number or boolean` };
    }
  }
  return { detail };
}

/**
 * Record an event from trusted server code. Never throws: tracking must not
 * break the flow it observes. Returns false (and logs) when it couldn't.
 */
export async function recordEvent(params: {
  userId: string;
  kind: UserEventKind;
  detail?: EventDetail;
  /** 'client' only for events accepted through POST /api/events. */
  source?: 'server' | 'client';
}): Promise<boolean> {
  try {
    if (!getEventDefinition(params.kind)) {
      console.error(`[events] unregistered kind: ${params.kind}`);
      return false;
    }
    const clean = sanitizeEventDetail(params.detail);
    if ('error' in clean) {
      console.error(`[events] ${params.kind}: ${clean.error}`);
      return false;
    }
    await db()
      .insert(userEvent)
      .values({
        id: getUuid(),
        userId: params.userId,
        kind: params.kind,
        detail: Object.keys(clean.detail).length
          ? JSON.stringify(clean.detail)
          : null,
        source: params.source ?? 'server',
        createdAt: new Date(),
      });
    return true;
  } catch (error) {
    console.error(`[events] failed to record ${params.kind}:`, error);
    return false;
  }
}

/**
 * Validate a browser-reported event: the kind must be registered with
 * `client: true` and the detail must pass the limits.
 */
export function parseClientEvent(
  body: unknown
):
  | { kind: UserEventKind; detail: EventDetail }
  | { error: string; status: number } {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { error: 'Invalid body', status: 400 };
  const { kind, detail } = body as { kind?: unknown; detail?: unknown };
  if (typeof kind !== 'string' || !getEventDefinition(kind)?.client)
    return { error: 'Unknown event', status: 400 };
  const clean = sanitizeEventDetail(detail);
  if ('error' in clean) return { error: clean.error, status: 400 };
  return { kind: kind as UserEventKind, detail: clean.detail };
}
