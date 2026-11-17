import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';

import { envConfigs } from '@/config';
import {
  finishExecution,
  getExecution,
  reserveExecution,
} from '@/modules/admin-access/service';
import { adminOperations, type AdminOperation } from '@/lib/admin-operations';
import { getUuid } from '@/lib/hash';
import { respErr } from '@/lib/resp';

import {
  authenticateAdmin,
  checkSessionOrigin,
  requirePermission,
} from './auth';
import { handlers } from './handlers';
import { AdminError, type AdminActor } from './types';

const MAX_REQUEST_BYTES = 2_000_000;
export async function readAdminJson(request: Request): Promise<unknown> {
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw new AdminError('Content-Type must be application/json', 415);
  if (Number(request.headers.get('content-length') || 0) > MAX_REQUEST_BYTES)
    throw new AdminError('Request too large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AdminError('JSON body required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new AdminError('Request too large', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AdminError('Invalid JSON');
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function adminErrorResponse(error: unknown) {
  if (error instanceof z.ZodError)
    return respErr(
      error.issues
        .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
        .join('; '),
      { status: 400 }
    );
  return respErr(
    error instanceof AdminError ? error.message : 'Internal error',
    { status: error instanceof AdminError ? error.status : 500 }
  );
}
export function findOperation(name: string): AdminOperation {
  const operation = adminOperations.find((item) => item.name === name);
  if (!operation) throw new AdminError('Unknown operation', 404);
  return operation;
}

/** Every entry point goes through this boundary; handlers cannot be called by a client. */
export async function executeAdmin(
  operation: AdminOperation,
  rawInput: unknown,
  actor: AdminActor,
  idempotencyKey?: string | null
) {
  requirePermission(actor, operation.permission);
  const input = operation.schema.parse(rawInput) as Record<string, unknown>;
  if (!operation.readOnly && actor.tokenId && !idempotencyKey)
    throw new AdminError('Idempotency-Key is required for admin token writes');
  if (idempotencyKey && !/^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey))
    throw new AdminError(
      'Idempotency key must be 8–128 letters, digits, dots, underscores, colons, or hyphens'
    );
  const inputHash = createHmac('sha256', envConfigs.auth_secret)
    .update(canonical(input))
    .digest('hex');
  const executionId =
    !operation.readOnly && idempotencyKey
      ? createHash('sha256')
          .update(
            JSON.stringify([
              actor.userId,
              actor.tokenId || 'session',
              operation.name,
              idempotencyKey,
            ])
          )
          .digest('hex')
      : getUuid();
  try {
    await reserveExecution({
      id: executionId,
      userId: actor.userId,
      tokenId: actor.tokenId || null,
      operation: operation.name,
      inputHash,
      targetId:
        String(
          input.id || input.userId || input.roleId || input.orderNo || ''
        ).slice(0, 191) || null,
      status: 'pending',
      createdAt: new Date(),
    });
  } catch (error) {
    const previous = await getExecution(executionId);
    if (!previous) throw error;
    if (previous.inputHash !== inputHash)
      throw new AdminError(
        'Idempotency key already used with different input',
        409
      );
    if (!previous.response)
      throw new AdminError(
        'Operation is pending or its outcome is unknown. Inspect the target before attempting another write.',
        409
      );
    const replay = JSON.parse(previous.response) as {
      status: number;
      body: unknown;
    };
    return Response.json(replay.body, {
      status: replay.status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': executionId,
        'Idempotency-Replayed': 'true',
      },
    });
  }

  // Reconstruct the existing handler's request from validated input, never forwarding credentials.
  const params: Record<string, string> = {};
  const path = operation.path.replace(/\{(\w+)\}/g, (_, key: string) => {
    params[key] = String(input[key]);
    return encodeURIComponent(params[key]);
  });
  const url = new URL(path, 'http://admin.internal');
  const body = { ...input };
  for (const key of Object.keys(params)) delete body[key];
  const queryMethod = ['GET', 'DELETE'].includes(operation.method);
  if (queryMethod)
    for (const [key, value] of Object.entries(body))
      if (value !== undefined) url.searchParams.set(key, String(value));
  const request = new Request(url, {
    method: operation.method,
    headers: { 'Content-Type': 'application/json' },
    ...(queryMethod ? {} : { body: JSON.stringify(body) }),
  });
  try {
    const response = await handlers[operation.name]({ request, params, actor });
    const result = (await response.json()) as {
      code: number;
      message: string;
      data?: unknown;
    };
    const status =
      result.code === 0
        ? response.status
        : response.status >= 400
          ? response.status
          : 400;
    // Read responses are not retained. Write responses enable durable replay without re-running effects.
    await finishExecution(
      executionId,
      result.code === 0 ? 'completed' : 'failed',
      operation.readOnly ? null : JSON.stringify({ status, body: result })
    );
    return Response.json(result, {
      status,
      headers: { 'Cache-Control': 'no-store', 'X-Request-Id': executionId },
    });
  } catch {
    // A handler or journaling failure can happen AFTER a side effect. Keep the reservation forever;
    // never automatically retry the action or claim it was rolled back.
    await finishExecution(executionId, 'unknown', null).catch(() => {});
    throw new AdminError(
      `Operation outcome unknown; inspect the target before retrying. Request ID: ${executionId}`,
      500
    );
  }
}

export async function runAdminRoute(
  name: string,
  context: { request: Request; params?: Record<string, string> }
) {
  try {
    const actor = await authenticateAdmin(context.request);
    checkSessionOrigin(context.request, actor);
    const operation = findOperation(name);
    requirePermission(actor, operation.permission);
    const input = ['GET', 'DELETE'].includes(operation.method)
      ? Object.fromEntries(new URL(context.request.url).searchParams)
      : await readAdminJson(context.request);
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new AdminError('Object input required');
    return await executeAdmin(
      operation,
      { ...input, ...context.params },
      actor,
      context.request.headers.get('idempotency-key')
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
