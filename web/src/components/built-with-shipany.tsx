import { Heart } from 'lucide-react';

import { envConfigs } from '@/config';
import { cn } from '@/lib/utils';

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * "Built with ShipAny" attribution. Optional under the ShipAny license (keep,
 * restyle, move or remove it). Colors inherit the surrounding text color, so
 * it fits dark footers, light surfaces and every theme.
 *
 * - pill: outlined capsule (default)
 * - text: a plain inline link
 */
export function BuiltWithShipAny({
  variant = 'pill',
  className,
}: {
  variant?: 'pill' | 'text';
  className?: string;
}) {
  const utm = encodeURIComponent(getHostname(envConfigs.app_url));
  const href = `https://shipany.ai/?utm_source=${utm}`;

  return (
    <a
      href={href}
      target="_blank"
      // No noreferrer: shipany.ai's analytics should see the referring site.
      rel="noopener"
      title="ShipAny: the SaaS boilerplate"
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-medium transition-colors',
        variant === 'pill'
          ? 'rounded-full border border-current/20 bg-current/5 px-3.5 py-1.5 opacity-90 hover:border-current/40 hover:bg-current/10 hover:opacity-100'
          : 'underline-offset-4 opacity-70 hover:underline hover:opacity-100',
        className
      )}
    >
      <span>Built with</span>
      <Heart aria-hidden className="size-3.5 fill-red-500 text-red-500" />
      <span>ShipAny</span>
    </a>
  );
}
