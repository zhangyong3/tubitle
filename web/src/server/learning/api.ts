import { getAuth } from '@/core/auth';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respErr } from '@/lib/resp';

export async function authorizeLearning(request: Request) {
  const isWrite = request.method !== 'GET';
  if (
    isWrite &&
    request.headers.get('origin') !== new URL(request.url).origin
  ) {
    return {
      response: respErr('Same-origin request required', { status: 403 }),
    };
  }
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: isWrite ? 100 : 20,
    burst: isWrite ? 1 : 20,
    keyPrefix: 'learning-ip',
  });
  if (limited) return { response: limited };
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user)
    return { response: respErr('Unauthorized', { status: 401 }) };
  const userLimited = enforceMinIntervalRateLimit(request, {
    intervalMs: isWrite ? 150 : 30,
    burst: isWrite ? 1 : 20,
    keyPrefix: 'learning-user',
    extraKey: session.user.id,
  });
  if (userLimited) return { response: userLimited };
  return { userId: session.user.id };
}
export async function readLearningBody(request: Request, maxBytes = 32768) {
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('application/json')
  )
    throw new Error('Expected JSON');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error('Body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
