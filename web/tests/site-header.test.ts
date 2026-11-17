import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Render the real header with controlled session/loading states, including SSR.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/components/site-header.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function renderHeader(session: { data: unknown; isPending: boolean }, mobileOpen: boolean) {
  const exports: Record<string, any> = {};
  const empty = () => null;
  const mocks: Record<string, unknown> = {
    react: { useState: () => [mobileOpen, empty] },
    '@/core/auth/client': { useSession: () => session },
    '@/core/i18n/navigation': { Link: ({ children, ...props }: any) => createElement('a', props, children) },
    '@/config': { envConfigs: { app_name: 'Tubitle', app_logo: '/logo.svg' } },
    '@/lib/utils': { cn: (...args: string[]) => args.join(' ') },
    '@/paraglide/messages.js': { m: { 'common.nav.get_started': () => 'Start learning' } },
    '@/components/locale-selector': { LocaleSelector: empty },
    '@/components/theme-toggle': { ThemeToggle: empty },
    '@/components/site-user-menu': { SiteUserMenu: () => createElement('span', null, 'User menu') },
    '@/components/ui/button': { buttonVariants: () => 'button' },
  };
  runInNewContext(compiled, { exports, require: (id: string) => mocks[id] ?? require(id) });
  return renderToStaticMarkup(createElement(exports.SiteHeader));
}

for (const mobileOpen of [false, true]) {
  const surface = mobileOpen ? 'desktop and mobile' : 'desktop';
  test(`${surface}: pending session never flashes guest CTA`, () => {
    const html = renderHeader({ data: null, isPending: true }, mobileOpen);
    assert.doesNotMatch(html, /Start learning/);
  });
  test(`${surface}: resolved guest can start learning`, () => {
    assert.match(renderHeader({ data: null, isPending: false }, mobileOpen), /Start learning/);
  });
  test(`${surface}: signed-in user sees account menu`, () => {
    const html = renderHeader({ data: { user: { name: 'Learner', email: 'learner@example.test' } }, isPending: false }, mobileOpen);
    assert.match(html, /User menu/);
    assert.doesNotMatch(html, /Start learning/);
  });
}
