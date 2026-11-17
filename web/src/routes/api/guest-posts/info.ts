import { createFileRoute } from '@tanstack/react-router';
import { guestPostSettings } from '@/server/guest-posts/settings';

import { listGuestPostPackages } from '@/config/pricing';
import { getAllConfigs } from '@/modules/config/service';
import { respData } from '@/lib/resp';

// Public: whether guest posts are open, the rules and the packages.
async function GET() {
  const settings = guestPostSettings(await getAllConfigs());
  return respData({
    enabled: settings.enabled,
    minWords: settings.minWords,
    packages: listGuestPostPackages().map((p) => ({
      productId: p.productId,
      planName: p.planName,
      description: p.description,
      priceInCents: p.priceInCents,
      currency: p.currency,
      cnyPriceInCents: p.cnyPriceInCents ?? null,
      maxLinks: p.maxLinks ?? 0,
    })),
  });
}

export const Route = createFileRoute('/api/guest-posts/info')({
  server: { handlers: { GET } },
});
