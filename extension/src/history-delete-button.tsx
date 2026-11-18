import { useState } from 'react';
import { t } from './shared/i18n';

export function HistoryDeleteButton({ label, onDelete, clearAll = false }: { label: string; onDelete: () => Promise<unknown>; clearAll?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  async function confirm() {
    if (deleting) return;
    setDeleting(true);
    try { await onDelete(); setConfirming(false); }
    finally { setDeleting(false); }
  }
  if (confirming) return <div className="history-delete-confirmation" role="group" aria-label={label} onKeyDown={event => {
    if (event.key === 'Escape' && !deleting) { event.preventDefault(); setConfirming(false); }
  }}>
    <button type="button" className="collapse-panel history-confirm-delete" disabled={deleting} onClick={() => void confirm()}>{t(clearAll ? '确认清空' : '确认删除')}</button>
    <button type="button" className="collapse-panel" disabled={deleting} autoFocus onClick={() => setConfirming(false)}>{t('取消')}</button>
  </div>;
  if (clearAll) return <button type="button" aria-label={label} onClick={() => setConfirming(true)}>{t('清空')}</button>;
  return <button type="button" className="history-icon history-delete" aria-label={label} title={t('删除这条本地历史')} onClick={() => setConfirming(true)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>
  </button>;
}
