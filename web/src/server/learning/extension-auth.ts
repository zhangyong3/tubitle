import { getAuth } from '@/core/auth';
import { respJson } from '@/lib/resp';

export async function authorizeExtension(request: Request) {
  const origin = request.headers.get('origin');
  // A custom header forces preflight for ordinary cross-site pages. These
  // routes never grant CORS; only the extension's host permission bypasses it.
  // Host-permitted extension GETs can omit Origin. Allow that read-only
  // discovery request; browsers cannot attach our custom header from an
  // ordinary cross-site page without a preflight, which we never authorize.
  // Writes still require an explicit trusted Origin and the session owner.
  const trustedOrigin = (origin === null && request.method === 'GET') ||
    origin === new URL(request.url).origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin || '');
  if (!trustedOrigin || request.headers.get('x-tubitle-extension') !== '1') return {
    response: respJson(-1, 'Invalid extension request', undefined, { status: 403 }),
  };
  const session = await getAuth().api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!session?.user || (request.method !== 'GET' && request.headers.get('x-tubitle-account') !== session.user.id)) return {
    response: respJson(-1, '请先登录 Tubitle 后使用此功能', { reason: 'LOGIN_REQUIRED' }, { status: 401, headers: { 'cache-control': 'private, no-store' } }),
  };
  return { userId: session.user.id as string, name: session.user.name as string };
}
