/**
 * Appearance presets: theme color, font, font size and sidebar layout. Off by
 * default: until the admin turns on APPEARANCE_ENABLED_KEY, nothing here
 * applies and the site renders from the code (`:root`/`.dark` in
 * globals.css, DEFAULT_APPEARANCE for the sidebar). Once on, the admin picks
 * them (Settings → General → Appearance). When
 * `user_theme_enabled` is on, a user may override the theme color only, from
 * the user menu (THEME_COOKIE). Light/dark lives in next-themes.
 *
 * - Themes: palettes live in `src/styles/globals.css` under
 *   `[data-theme='<id>']`. To add one, append it here, add its CSS block, and
 *   add `common.themes.<id>` to messages/{en,zh}.json.
 * - Fonts: `stack` becomes `--font-sans` on <html>. Self-hosted fonts are
 *   imported in `src/routes/__root.tsx`; @font-face files only download when
 *   a font is actually used. Labels: `common.fonts.<id>`.
 * - Sizes: `scale` becomes the root font-size, so rem-based spacing scales
 *   with it (like browser zoom). Labels: `common.font_sizes.<id>`.
 */
export const THEMES = [
  { id: 'classic', swatch: 'oklch(0.22 0.005 60)' },
  { id: 'forest', swatch: 'oklch(0.52 0.12 150)' },
  { id: 'ocean', swatch: 'oklch(0.5 0.15 255)' },
  { id: 'violet', swatch: 'oklch(0.48 0.17 290)' },
  { id: 'sunset', swatch: 'oklch(0.58 0.16 42)' },
  { id: 'rose', swatch: 'oklch(0.54 0.18 10)' },
  { id: 'slate', swatch: 'oklch(0.3 0.03 260)' },
] as const;

export const FONTS = [
  // Matches :root --font-sans in globals.css.
  { id: 'inter', stack: "'Inter Variable', 'Inter', sans-serif" },
  {
    id: 'system',
    stack:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  },
  {
    id: 'rounded',
    stack: "'Nunito Variable', ui-rounded, 'SF Pro Rounded', sans-serif",
  },
  {
    id: 'serif',
    stack:
      "'Source Serif 4 Variable', ui-serif, Georgia, 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif",
  },
] as const;

export const FONT_SIZES = [
  { id: 'sm', scale: '93.75%' },
  { id: 'md', scale: '100%' },
  { id: 'lg', scale: '107.5%' },
] as const;

// shadcn <Sidebar variant>: inset = colored frame around a content card,
// floating = the sidebar is a floating card, sidebar = classic full height.
export const SIDEBAR_VARIANTS = [
  { id: 'inset' },
  { id: 'floating' },
  { id: 'sidebar' },
] as const;

// shadcn <Sidebar collapsible>: what the toggle does on desktop.
export const SIDEBAR_COLLAPSIBLES = [
  { id: 'offcanvas' },
  { id: 'icon' },
] as const;

/**
 * Light/dark. Owned by next-themes (per browser, localStorage), not by the
 * cookie-backed parts below. DEFAULT_COLOR_MODE is the code's default (set it
 * to 'dark' for a dark-first brand; don't hard-code ThemeProvider props). With
 * the switch on, the admin's `app_color_mode` replaces it, and is forced on
 * everyone when `user_theme_enabled` is off (unless it is 'system').
 */
export const COLOR_MODES = [
  { id: 'system' },
  { id: 'light' },
  { id: 'dark' },
] as const;
export type ColorModeId = (typeof COLOR_MODES)[number]['id'];
export const COLOR_MODE_CONFIG_KEY = 'app_color_mode';
export const DEFAULT_COLOR_MODE: ColorModeId = 'light';

export function isColorMode(value: unknown): value is ColorModeId {
  return typeof value === 'string' && COLOR_MODES.some((m) => m.id === value);
}

export type ThemeId = (typeof THEMES)[number]['id'];
export type FontId = (typeof FONTS)[number]['id'];
export type FontSizeId = (typeof FONT_SIZES)[number]['id'];
export type SidebarVariantId = (typeof SIDEBAR_VARIANTS)[number]['id'];
export type SidebarCollapsibleId = (typeof SIDEBAR_COLLAPSIBLES)[number]['id'];

export interface Appearance {
  theme: ThemeId;
  font: FontId;
  fontSize: FontSizeId;
  sidebarVariant: SidebarVariantId;
  sidebarCollapsible: SidebarCollapsibleId;
}
export type AppearanceKey = keyof Appearance;

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'classic',
  font: 'inter',
  fontSize: 'md',
  sidebarVariant: 'inset',
  sidebarCollapsible: 'offcanvas',
};

const OPTIONS: Record<AppearanceKey, readonly { id: string }[]> = {
  theme: THEMES,
  font: FONTS,
  fontSize: FONT_SIZES,
  sidebarVariant: SIDEBAR_VARIANTS,
  sidebarCollapsible: SIDEBAR_COLLAPSIBLES,
};

/** Admin config key holding the site default for each part. */
export const APPEARANCE_CONFIG_KEYS: Record<AppearanceKey, string> = {
  theme: 'app_theme',
  font: 'app_font',
  fontSize: 'app_font_size',
  sidebarVariant: 'app_sidebar_variant',
  sidebarCollapsible: 'app_sidebar_collapsible',
};

/** Master switch: 'true' turns the admin's appearance settings on. */
export const APPEARANCE_ENABLED_KEY = 'appearance_enabled';

/** Cookie holding a user's own theme color (only honored when allowed). */
export const THEME_COOKIE = 'app_theme';

export const APPEARANCE_KEYS = Object.keys(OPTIONS) as AppearanceKey[];

/** Values land in HTML attributes and inline styles: allow-list only. */
export function isAppearanceValue<K extends AppearanceKey>(
  key: K,
  value: unknown
): value is Appearance[K] {
  return typeof value === 'string' && OPTIONS[key].some((o) => o.id === value);
}

export type PartialAppearance = { [K in AppearanceKey]: Appearance[K] | null };

/** Known values from `source`, or null for anything missing or unknown. */
export function pickAppearance(
  source: Partial<Record<AppearanceKey, string | undefined>>
): PartialAppearance {
  return Object.fromEntries(
    APPEARANCE_KEYS.map((k) => [
      k,
      isAppearanceValue(k, source[k]) ? source[k] : null,
    ])
  ) as PartialAppearance;
}

/** Fill the gaps in `top` from `base`, part by part. */
export function mergeAppearance(
  top: PartialAppearance,
  base: Appearance
): Appearance {
  return Object.fromEntries(
    APPEARANCE_KEYS.map((k) => [k, top[k] ?? base[k]])
  ) as unknown as Appearance;
}

/** Inline style for <html>: only what differs from the stylesheet defaults. */
export function appearanceStyle(a: Appearance): Record<string, string> {
  const style: Record<string, string> = {};
  if (a.font !== DEFAULT_APPEARANCE.font) {
    style['--font-sans'] = FONTS.find((f) => f.id === a.font)!.stack;
  }
  if (a.fontSize !== DEFAULT_APPEARANCE.fontSize) {
    style.fontSize = FONT_SIZES.find((s) => s.id === a.fontSize)!.scale;
  }
  return style;
}
