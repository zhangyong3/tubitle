import { useEffect, useState } from 'react';
import { t, getUiLanguage } from './shared/i18n';
import { useI18n } from './shared/use-i18n';
import { sendMessage } from './shared/messaging';
import { TUBITLE_SITE_URL, type SyncStatus } from './shared/learning-sync';

export function learningDuration(durationMs = 0): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
}

interface IndicatorProps { loginNotice?: string; onCollapse?: () => void }

export function LearningSyncStatusView({ status, loginNotice, onCollapse }: IndicatorProps & { status?: SyncStatus }) {
  const base = `${TUBITLE_SITE_URL}/${getUiLanguage().startsWith('zh') ? 'zh' : 'en'}`;
  return <div className={`learning-sync-indicator${status?.connected ? ' connected' : loginNotice ? ' login-required' : ''}`} role={!status?.connected && loginNotice ? 'alert' : 'status'}>
    <div className="learning-sync-content">
      {status?.connected ? <>
        <a className="learning-account" href={`${base}/settings`} target="_blank" rel="noreferrer">{status.name || 'Tubitle'}</a>
        <span className="learning-today">{t('今日 {0} 句', status.today?.sentences ?? 0)}</span>
        <span className="learning-duration">{t('时长 {0}', learningDuration(status.today?.durationMs))}</span>
        {(status.error || status.pending > 0) && <span className="learning-sync-detail">{status.error ? t(status.error) : t('学习库：{0} 条待上传', status.pending)}</span>}
      </> : <>
        {loginNotice && <span className="learning-login-notice">{t(loginNotice)}</span>}
        {status || loginNotice ? <a className="learning-login-link" href={`${base}/sign-in`} target="_blank" rel="noreferrer">
          {t(loginNotice ? '登录 Tubitle' : '登录 Tubitle，自动同步学习记录')}<span aria-hidden="true"> ↗</span>
        </a> : <span>{t('正在检查 Tubitle 登录状态…')}</span>}
        {status?.error && <span className="learning-sync-detail">{t(status.error)}</span>}
      </>}
    </div>
    {onCollapse && <button type="button" className="collapse-panel learning-collapse" aria-label={t('收起学习面板')} onClick={onCollapse}>{t('收起')}</button>}
  </div>;
}

export function LearningSyncIndicator({ loginNotice, onCollapse }: IndicatorProps) {
  useI18n();
  const [status, setStatus] = useState<SyncStatus>();
  useEffect(() => {
    let active = true;
    const refresh = () => { void sendMessage<SyncStatus>({ type: 'LEARNING_SYNC_STATUS' }).then(value => { if (active) setStatus(value); }).catch(() => { if (active) setStatus({ connected: false, pending: 0, error: '暂时无法连接 Tubitle，请稍后重试' }); }); };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [loginNotice]);
  return <LearningSyncStatusView status={status} loginNotice={loginNotice} onCollapse={onCollapse} />;
}
