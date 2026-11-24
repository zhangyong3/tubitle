import { t } from './shared/i18n';
import { nextSubtitleDisplayMode, type SubtitleDisplayMode } from './shared/subtitle-display';

export function SubtitleToolbar({ mode, onModeChange, autoFollow, onAutoFollowChange, canExport, exporting, onExport }: {
  mode: SubtitleDisplayMode; onModeChange: (mode: SubtitleDisplayMode) => void;
  autoFollow: boolean; onAutoFollowChange: (value: boolean) => void;
  canExport: boolean; exporting: boolean; onExport: () => void;
}) {
  const names = { hidden: t('不显示字幕'), bilingual: t('显示双语字幕'), source: t('仅显示源语字幕') };
  const modeLabel = t('当前：{0}；点击切换为：{1}', names[mode], names[nextSubtitleDisplayMode(mode)]);
  const exportLabel = exporting ? t('生成中…') : t('下载 PDF');
  const followLabel = autoFollow ? t('关闭自动跟随') : t('开启自动跟随');
  return <div className="transcript-actions">
    <span className="subtitle-tool" data-tooltip={modeLabel}>
      <button type="button" className={`subtitle-icon mode-${mode}`} aria-label={modeLabel} title={modeLabel} onClick={() => onModeChange(nextSubtitleDisplayMode(mode))}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" />
          {mode === 'hidden' ? <path d="m4 3 16 18" /> : mode === 'source' ? <path d="M7 12h10" /> : <path d="M7 10h4m3 0h3M7 14h3m3 0h4" />}
        </svg>
      </button>
    </span>
    <span className="subtitle-tool" data-tooltip={exportLabel}>
      <button type="button" className="subtitle-icon export-pdf" aria-label={exportLabel} title={exportLabel} disabled={!canExport || exporting} aria-busy={exporting} onClick={onExport}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" /></svg>
      </button>
    </span>
    <span className="subtitle-tool" data-tooltip={followLabel}>
      <button type="button" className="subtitle-icon" aria-label={followLabel} title={followLabel} aria-pressed={autoFollow} onClick={() => onAutoFollowChange(!autoFollow)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4M8 12h8m-4-4v8" /></svg>
      </button>
    </span>
  </div>;
}
