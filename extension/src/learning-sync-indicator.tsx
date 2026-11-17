import { useEffect, useState } from 'react';
import { sendMessage } from './shared/messaging';
import { TUBITLE_SITE_URL, type SyncStatus } from './shared/learning-sync';
export function LearningSyncIndicator() {
  const [status, setStatus] = useState<SyncStatus>();
  useEffect(() => {
    const refresh = () => { void sendMessage<SyncStatus>({ type: 'LEARNING_SYNC_STATUS' }).then(setStatus).catch(() => setStatus({ connected: false, pending: 0, error: '暂时无法连接 Tubitle，请稍后重试' })); };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="learning-sync-indicator" role="status">
    <a href={`${TUBITLE_SITE_URL}/zh/${status?.connected ? 'settings' : 'sign-in'}`} target="_blank" rel="noreferrer">{status?.connected ? status.error || (status.pending ? `学习库：${status.pending} 条待上传` : '学习库：自动同步') : status?.error || (status ? '登录 Tubitle，自动同步学习记录' : '正在检查 Tubitle 登录状态…')}</a>
  </div>;
}
