export const ANALYSIS_DAILY_LIMITS = { free: 3, pro: 100 } as const;
export const PRO_PRODUCT_IDS = ['tubitle-pro-monthly', 'tubitle-pro-yearly'];
export function analysisDay(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function analysisResetAt(now = new Date()) {
  return new Date(Date.parse(`${analysisDay(now)}T00:00:00+08:00`) + 86400000).toISOString();
}
