export const LEGACY_QUOTA_TIME_ZONE = 'Asia/Shanghai';
export const REGISTRATION_TIME_ZONE_COOKIE = 'tubitle_registration_timezone';

export function normalizeQuotaTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) return LEGACY_QUOTA_TIME_ZONE;
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone; }
  catch { return LEGACY_QUOTA_TIME_ZONE; }
}
const formatters = new Map<string, Intl.DateTimeFormat>();
function dateKey(date: Date, timeZone: string): string {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    if (formatters.size >= 1000) formatters.delete(formatters.keys().next().value!);
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export function quotaDayWindow(now = new Date(), zone: string = LEGACY_QUOTA_TIME_ZONE) {
  const timeZone = normalizeQuotaTimeZone(zone);
  const day = dateKey(now, timeZone);
  const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  function boundary(key: string) {
    const utc = Date.parse(`${key}T00:00:00Z`);
    let low = utc - 48 * 3600000, high = utc + 48 * 3600000;
    // Find the first instant of the local date, including 23/25-hour DST days.
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (dateKey(new Date(middle), timeZone) < key) low = middle + 1;
      else high = middle;
    }
    return new Date(low);
  }
  return { day, start: boundary(day), end: boundary(nextDay), timeZone };
}
