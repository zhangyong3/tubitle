/** Guest post settings from admin config, with defaults. */
export function guestPostSettings(configs: Record<string, string>) {
  const int = (v: string | undefined, fallback: number, max: number) => {
    const n = parseInt(v || '', 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
  };
  return {
    enabled: configs.guest_post_enabled === 'true',
    minWords: int(configs.guest_post_min_words, 300, 10_000),
  };
}
