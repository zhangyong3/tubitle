import { m } from '@/paraglide/messages.js';
import { SiteFooter } from '@/components/site-footer';

export function Footer() {
  return (
    <SiteFooter
      tagline={m['tubitle.footer.tagline']()}
      columns={[
        {
          title: m['tubitle.footer.product'](),
          links: [
            { label: m['tubitle.nav.features'](), href: '/#features' },
            { label: m['tubitle.nav.pricing'](), href: '/pricing' },
          ],
        },
        {
          title: m['tubitle.footer.account'](),
          links: [
            { label: m['tubitle.nav.library'](), href: '/settings' },
            { label: m['common.sign.sign_in_title'](), href: '/sign-in' },
          ],
        },
        {
          title: m['tubitle.footer.legal'](),
          links: [
            { label: m['landing.footer.privacy'](), href: '/privacy-policy' },
            { label: m['landing.footer.terms'](), href: '/terms-of-service' },
          ],
        },
      ]}
      builtWith="text"
    />
  );
}
