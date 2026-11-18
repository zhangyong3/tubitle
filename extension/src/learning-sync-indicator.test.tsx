import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LearningSyncStatusView, learningDuration } from './learning-sync-indicator';
import { setUiLanguage } from './shared/i18n';

it('makes sign-in a visible hyperlink, and shows AI login notices in the same bar', () => {
  setUiLanguage('zh-CN');
  const html = renderToStaticMarkup(<LearningSyncStatusView status={{ connected: false, pending: 0 }} loginNotice="请先登录 Tubitle 后使用 AI 解析" />);
  expect(html).toContain('learning-login-link');
  expect(html).toContain('/zh/sign-in');
  expect(html).toContain('请先登录 Tubitle 后使用 AI 解析');
  expect(html).toContain('role="alert"');
});
it('shows the account name and real current-day totals after login', () => {
  setUiLanguage('zh-CN');
  const html = renderToStaticMarkup(<LearningSyncStatusView status={{ connected: true, name: 'Alice', pending: 0, today: { sentences: 42, durationMs: 3723000 } }} loginNotice="请先登录 Tubitle 后使用 AI 解析" />);
  expect(html).toContain('Alice');
  expect(html).toContain('今日 42 句');
  expect(html).toContain('时长 01:02:03');
  expect(html).not.toContain('/sign-in');
  expect(html).not.toContain('请先登录');
  expect(learningDuration(0)).toBe('00:00:00');
});
