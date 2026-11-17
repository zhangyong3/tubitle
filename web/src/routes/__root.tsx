/// <reference types="vite/client" />
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { ThemeProvider } from 'next-themes';

import { envConfigs } from '@/config';
import {
  APPEARANCE_CONFIG_KEYS,
  APPEARANCE_ENABLED_KEY,
  APPEARANCE_KEYS,
  appearanceStyle,
  COLOR_MODE_CONFIG_KEY,
  DEFAULT_APPEARANCE,
  DEFAULT_COLOR_MODE,
  isColorMode,
  mergeAppearance,
  pickAppearance,
  THEME_COOKIE,
} from '@/config/appearance';
import { parseCookieConsent } from '@/lib/cookie-consent';
import { getQueryClient } from '@/lib/query-client';
import { getLocale, locales, localizeUrl } from '@/paraglide/runtime.js';
import { useAppearance } from '@/hooks/use-appearance';
import { useCookieConsent } from '@/hooks/use-cookie-consent';
import { CookieConsent } from '@/blocks/cookie-consent';
import { Ads } from '@/components/analytics/ads';
import { GoogleAnalytics } from '@/components/analytics/google-analytics';
import { Plausible } from '@/components/analytics/plausible';
import { CustomerService } from '@/components/customer-service';
import { GoogleOneTap } from '@/components/google-one-tap';
import { SandboxPreviewBridge } from '@/components/sandbox-preview-bridge';
import { Toaster } from '@/components/ui/sonner';

import '@fontsource-variable/inter';
import '@fontsource-variable/nunito';
import '@fontsource-variable/source-serif-4';
import '@fontsource/libre-baskerville/400.css';
import '@fontsource/libre-baskerville/700.css';
import '@fontsource/libre-baskerville/400-italic.css';
import '@/styles/globals.css';

// Analytics IDs live in the DB config (1h-cached service). Fetched via a
// server function so drizzle/db code never reaches the client bundle.
const getAnalyticsConfigs = createServerFn().handler(async () => {
  const { getAllConfigs } = await import('@/modules/config/service');
  const { getCookie } = await import('@tanstack/react-start/server');
  const { safeEmbedSetting } = await import('@/lib/embed-ids');
  const configs = await getAllConfigs();
  // Host allow-list (PLAUSIBLE_SCRIPT_HOSTS) is runtime server env. A
  // configured src that fails it turns Plausible off rather than falling
  // back to the plausible.io script.
  const rawPlausibleSrc = configs.plausible_src?.trim() || '';
  const plausibleSrc = safeEmbedSetting('plausible_src', rawPlausibleSrc);
  const plausibleOff = !!rawPlausibleSrc && !plausibleSrc;
  const cookieConsentEnabled = configs.cookie_consent_enabled === 'true';
  // Appearance: off by default, and then the code's own styles apply
  // untouched. On: the admin's site settings; users may override only the
  // theme color (cookie) when allowed. Everything goes through the allow-list.
  const appearanceEnabled = configs[APPEARANCE_ENABLED_KEY] === 'true';
  const userThemeEnabled =
    appearanceEnabled && configs.user_theme_enabled === 'true';
  const site = pickAppearance(
    appearanceEnabled
      ? Object.fromEntries(
          APPEARANCE_KEYS.map((k) => [k, configs[APPEARANCE_CONFIG_KEYS[k]]])
        )
      : {}
  );
  const user = pickAppearance({
    theme: userThemeEnabled ? getCookie(THEME_COOKIE) : undefined,
  });
  const siteAppearance = mergeAppearance(site, DEFAULT_APPEARANCE);
  const rawColorMode = configs[COLOR_MODE_CONFIG_KEY];
  const colorMode =
    appearanceEnabled && isColorMode(rawColorMode)
      ? rawColorMode
      : DEFAULT_COLOR_MODE;
  return {
    appearanceEnabled,
    colorMode,
    colorModeForced:
      appearanceEnabled && !userThemeEnabled && colorMode !== 'system',
    appearance: mergeAppearance(user, siteAppearance),
    siteAppearance,
    userTheme: user.theme,
    userThemeEnabled,
    cookieConsentEnabled,
    // The visitor's saved choice, so SSR can render consented scripts.
    cookieConsent: cookieConsentEnabled
      ? parseCookieConsent(getCookie('cookie_consent'))
      : null,
    gaId: configs.google_analytics_id?.trim() || '',
    plausibleDomain: plausibleOff ? '' : configs.plausible_domain?.trim() || '',
    plausibleSrc,
    adsenseCode: configs.adsense_code?.trim() || '',
    crispWebsiteId:
      configs.crisp_enabled === 'true'
        ? configs.crisp_website_id?.trim() || ''
        : '',
    tawkPropertyId:
      configs.tawk_enabled === 'true'
        ? configs.tawk_property_id?.trim() || ''
        : '',
    tawkWidgetId:
      configs.tawk_enabled === 'true'
        ? configs.tawk_widget_id?.trim() || ''
        : '',
  };
});

export const Route = createRootRoute({
  loader: () => getAnalyticsConfigs(),
  head: () => {
    // head() runs on the SSR server AND again on the client during hydration.
    // On the client, app_url falls back to the localhost dev default when
    // VITE_APP_URL wasn't inlined into the client bundle at build — which would
    // emit a second, localhost set of hreflang links. Prefer the live origin
    // on the client so it always matches; the server uses the configured URL.
    const appUrl =
      (typeof window !== 'undefined' && window.location?.origin) ||
      envConfigs.app_url ||
      '';
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { title: envConfigs.app_name },
        { name: 'description', content: envConfigs.app_description },
        { name: 'generator', content: 'ShipAny' },
      ],
      links: [
        { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/favicon.svg' },
        ...locales.map((loc) => ({
          rel: 'alternate',
          hrefLang: loc,
          href: localizeUrl(`${appUrl}/`, { locale: loc }).href,
        })),
      ],
    };
  },
  component: RootComponent,
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
  errorComponent: RootError,
});

function RootComponent() {
  const analytics = Route.useLoaderData();
  const consentEnabled = !!analytics?.cookieConsentEnabled;
  const consent = useCookieConsent(analytics?.cookieConsent ?? null);
  // With the banner on, ad scripts wait for an explicit "accept".
  const adsAllowed = !consentEnabled || consent === 'accepted';

  return (
    <QueryClientProvider client={getQueryClient()}>
      <ThemeProvider
        attribute="class"
        defaultTheme={analytics?.colorMode ?? DEFAULT_COLOR_MODE}
        forcedTheme={
          analytics?.colorModeForced ? analytics.colorMode : undefined
        }
        enableSystem
        disableTransitionOnChange
      >
        <Outlet />
        <SandboxPreviewBridge />
        {/* Appearance on: toasts follow the theme (globals.css). */}
        <Toaster
          position="top-center"
          richColors={!analytics?.appearanceEnabled}
        />
        <GoogleOneTap />
        {analytics?.gaId ? (
          <GoogleAnalytics
            measurementId={analytics.gaId}
            consentMode={consentEnabled}
          />
        ) : null}
        {analytics?.plausibleDomain || analytics?.plausibleSrc ? (
          <Plausible
            domain={analytics.plausibleDomain}
            src={analytics.plausibleSrc || undefined}
          />
        ) : null}
        {analytics?.adsenseCode ? (
          <Ads code={analytics.adsenseCode} loadScript={adsAllowed} />
        ) : null}
        <CustomerService
          crispWebsiteId={analytics?.crispWebsiteId || undefined}
          tawkPropertyId={analytics?.tawkPropertyId || undefined}
          tawkWidgetId={analytics?.tawkWidgetId || undefined}
        />
        {consentEnabled ? (
          <CookieConsent initial={analytics?.cookieConsent ?? null} />
        ) : null}
      </ThemeProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  const { appearance, appearanceEnabled } = useAppearance();
  return (
    <html
      lang={getLocale()}
      data-theme={appearanceEnabled ? appearance.theme : undefined}
      style={appearanceEnabled ? appearanceStyle(appearance) : undefined}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
      </head>
      <body className="font-sans antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-6xl font-bold">404</h1>
      <p className="text-muted-foreground">Page not found</p>
      <a href="/" className="text-sm underline underline-offset-4">
        Back to home
      </a>
    </div>
  );
}

function RootError({ error, reset }: ErrorComponentProps) {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">Oops</h1>
      <p className="text-muted-foreground">
        Something went wrong. Please try again.
      </p>
      {import.meta.env.DEV && error instanceof Error && (
        <pre className="bg-muted mt-2 max-w-lg overflow-auto rounded p-4 text-xs">
          {error.message}
        </pre>
      )}
      <button
        type="button"
        onClick={reset}
        className="text-sm underline underline-offset-4"
      >
        Try again
      </button>
    </div>
  );
}
