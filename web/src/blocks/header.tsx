import { m } from '@/paraglide/messages.js';
import { SiteHeader } from '@/components/site-header';

export function Header() {
  return (
    <SiteHeader
      navLinks={[
        { href: '/#features', label: m['tubitle.nav.features']() },
        { href: '/pricing', label: m['tubitle.nav.pricing']() },
        { href: '/settings', label: m['tubitle.nav.library']() },
      ]}
    />
  );
}
