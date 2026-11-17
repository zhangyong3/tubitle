import { SYNC_STATE_KEY, TUBITLE_SITE_URL, type SyncRecord, type SyncStatus } from './shared/learning-sync';
interface Account { userId: string; name: string }
interface State { account?: Account; queue: SyncRecord[]; lastSyncedAt?: number; error?: string }
let writes = Promise.resolve();
let flushing: Promise<void> | undefined;
let refreshing: Promise<Account | undefined> | undefined;
async function read(): Promise<State> {
  // Discard retired manual credentials/queues; local query history is separate.
  await chrome.storage.local.remove?.('learningSyncState');
  return (await chrome.storage.local.get(SYNC_STATE_KEY))[SYNC_STATE_KEY] as State || { queue: [] };
}
function mutate(fn: (state: State) => void): Promise<void> {
  const next = writes.then(async () => { const state = await read(); fn(state); await chrome.storage.local.set({ [SYNC_STATE_KEY]: state }); });
  writes = next.catch(() => undefined);
  return next;
}
async function request(path: string, data?: unknown, userId?: string, signal?: AbortSignal) {
  const init: RequestInit = {
    method: data ? 'POST' : 'GET', credentials: 'include', redirect: 'error', cache: 'no-store',
    signal: AbortSignal.any([AbortSignal.timeout(path === 'analysis' ? 65000 : 15000), ...(signal ? [signal] : [])]),
    headers: { 'X-Tubitle-Extension': '1', ...(userId ? { 'X-Tubitle-Account': userId } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  };
  let response = await fetch(`${TUBITLE_SITE_URL}/api/extension/${path}`, init);
  if (!data && response.status === 429) {
    await new Promise(resolve => setTimeout(resolve, 250));
    response = await fetch(`${TUBITLE_SITE_URL}/api/extension/${path}`, init);
  }
  return response;
}
async function signedOut() {
  await mutate(state => { state.account = undefined; state.queue = []; state.error = undefined; state.lastSyncedAt = undefined; });
}
export function refreshAccount(): Promise<Account | undefined> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const response = await request('learning');
    if (response.status === 401) { await signedOut(); return undefined; }
    const payload = await response.json() as { code: number; data?: Account };
    if (!response.ok || payload.code !== 0 || !payload.data?.userId) throw new Error('暂时无法确认登录状态');
    const account = payload.data;
    await mutate(state => {
      if (state.account?.userId !== account.userId) { state.queue = []; state.lastSyncedAt = undefined; }
      state.account = account; state.error = undefined;
    });
    return account;
  })().finally(() => { refreshing = undefined; });
  return refreshing;
}
export async function syncStatus(): Promise<SyncStatus> {
  let verified = false;
  let connectionError: string | undefined;
  try { await refreshAccount(); verified = true; } catch { connectionError = '暂时无法连接 Tubitle，请稍后重试'; }
  await writes;
  const state = await read();
  return { connected: verified && !!state.account, name: state.account?.name, pending: state.queue.length, lastSyncedAt: state.lastSyncedAt, error: connectionError || state.error };
}
export async function enqueueLearning(record: SyncRecord) {
  let account: Account | undefined;
  try { account = await refreshAccount(); } catch { return; }
  if (!account) return; // Anonymous queries stay local and are never backfilled.
  await mutate(state => {
    if (state.account?.userId !== account.userId || state.queue.some(item => item.clientRecordId === record.clientRecordId)) return;
    if (state.queue.length >= 1000) { state.error = '待上传记录已达上限，新记录保存在本地历史中'; return; }
    state.queue.push(record);
  });
  void flushLearning().catch(() => undefined);
}
export function flushLearning(): Promise<void> {
  if (flushing) return flushing;
  flushing = drain().finally(() => { flushing = undefined; });
  return flushing;
}
async function drain() {
  await writes;
  const account = (await read()).account;
  if (!account) return;
  for (let i = 0; i < 20; i++) {
    await writes;
    const state = await read();
    const record = state.queue[0];
    if (state.account?.userId !== account.userId || !record) return;
    try {
      // Server compares this queue owner against the live cookie session atomically
      // with authentication. A newly signed-in account cannot receive old records.
      const response = await request('learning', record, account.userId);
      if (response.status === 401) { await signedOut(); return; }
      const payload = await response.json() as { code?: number };
      if (!response.ok || payload.code !== 0) throw new Error('上传暂未成功，稍后自动重试');
      await mutate(current => {
        if (current.account?.userId !== account.userId) return;
        current.queue = current.queue.filter(item => item.clientRecordId !== record.clientRecordId);
        current.error = undefined; current.lastSyncedAt = Date.now();
      });
    } catch {
      await mutate(current => { if (current.account?.userId === account.userId) current.error = '上传暂未成功，稍后自动重试'; });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
export class AnalysisAccessError extends Error {
  constructor(message: string, public reason?: string, public actionUrl?: string) { super(message); }
}
export async function requestAccountAnalysis(sentence: string, requestId: string, signal: AbortSignal): Promise<Response> {
  const account = await refreshAccount();
  if (!account) throw new AnalysisAccessError('请先登录 Tubitle 后使用 AI 解析', 'LOGIN_REQUIRED', `${TUBITLE_SITE_URL}/zh/sign-in`);
  const response = await request('analysis', { sentence, requestId }, account.userId, signal);
  const payload = await response.json() as { code?: number; message?: string; data?: { reason?: string; choices?: unknown } };
  if (!response.ok || payload.code !== 0) {
    if (response.status === 401) await signedOut();
    const reason = payload.data?.reason;
    throw new AnalysisAccessError(payload.message || 'AI 解析暂不可用，本次未扣除额度', reason,
      reason === 'QUOTA_EXHAUSTED' ? `${TUBITLE_SITE_URL}/zh/pricing` : reason === 'LOGIN_REQUIRED' ? `${TUBITLE_SITE_URL}/zh/sign-in` : undefined);
  }
  // Do not display/upload an old account's result after a login switch.
  if ((await refreshAccount())?.userId !== account.userId) throw new Error('账户已切换，请重新发起解析');
  return Response.json(payload.data);
}
