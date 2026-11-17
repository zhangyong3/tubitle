/**
 * Formats for third-party IDs that admin settings feed into inline <script>
 * tags / script URLs (analytics, ads, customer-service widgets). Anything that
 * doesn't match is refused on save and dropped at render, so a settings value
 * can never break out of the script string it is interpolated into.
 */
const EMBED_ID_PATTERNS: Record<string, RegExp> = {
  google_analytics_id: /^[A-Za-z]{1,3}-[A-Za-z0-9-]{4,30}$/, // G-XXXX, UA-1-1
  adsense_code: /^(ca-)?pub-\d{6,24}$/,
  crisp_website_id: /^[A-Za-z0-9-]{8,64}$/, // UUID
  tawk_property_id: /^[A-Za-z0-9]{8,64}$/,
  tawk_widget_id: /^[A-Za-z0-9_-]{1,64}$/, // e.g. 1h2k3l4m or default
};

/**
 * Hosts allowed to serve the Plausible script. A script URL runs with the
 * site's full authority (including in admins' browsers), so "any https URL"
 * would let anyone with settings.write load their own JS. Self-hosted
 * Plausible is opted into by deployment config, never by a settings value:
 * PLAUSIBLE_SCRIPT_HOSTS=stats.example.com,plausible.example.org
 *
 * Read at runtime on the server (process.env, or the Workers env), so a
 * restart or redeploy picks it up without a rebuild. The older build-time
 * VITE_PLAUSIBLE_SCRIPT_HOSTS still counts. Same-site paths (a
 * /js/script.js proxy) are always allowed.
 */
export function plausibleScriptHosts(): string[] {
  const g = globalThis as any;
  const runtime: Record<string, string | undefined> = {
    ...(g.__CF_ENV__ ?? {}),
    ...(typeof process !== 'undefined' ? process.env : {}),
  };
  const metaEnv: Record<string, string | undefined> =
    (import.meta as any).env ?? {};
  const raw = [
    runtime.PLAUSIBLE_SCRIPT_HOSTS,
    runtime.VITE_PLAUSIBLE_SCRIPT_HOSTS,
    metaEnv.VITE_PLAUSIBLE_SCRIPT_HOSTS,
  ]
    .filter((v) => typeof v === 'string')
    .join(',');
  return [
    'plausible.io',
    ...raw
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  ];
}

/**
 * A same-site path or a credential-free https URL. Only the shape: which
 * hosts may serve the script is checked on the server (isValidEmbedSetting),
 * because the host list is server runtime config the browser can't see.
 */
export function isScriptUrlShape(value: string): boolean {
  // A same-site path (e.g. a /js/script.js proxy) serves the site's own code.
  // Resolving it against a sentinel origin rejects //host and /\host tricks.
  if (value.startsWith('/')) {
    const base = 'https://same-site.invalid';
    try {
      return new URL(value, base).origin === base;
    } catch {
      return false;
    }
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isAllowedPlausibleSrc(value: string) {
  if (!isScriptUrlShape(value)) return false;
  if (value.startsWith('/')) return true;
  return plausibleScriptHosts().includes(new URL(value).hostname.toLowerCase());
}

/** True for blank or well-formed values of a known embed setting; other names always pass. */
export function isValidEmbedSetting(name: string, value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (name === 'plausible_src') return isAllowedPlausibleSrc(v);
  const pattern = EMBED_ID_PATTERNS[name];
  return pattern ? pattern.test(v) : true;
}

/** The trimmed value if it is a well-formed embed setting, otherwise ''. */
export function safeEmbedSetting(
  name: string,
  value: string | null | undefined
): string {
  const v = value?.trim() || '';
  return v && isValidEmbedSetting(name, v) ? v : '';
}
