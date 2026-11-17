import { Check, FileText, Search, Wallet } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { formatPrice, useGuestPostInfo } from '@/hooks/use-guest-posts';
import { buttonVariants } from '@/components/ui/button';

// /guest-post: how guest posts work and the packages.
export function GuestPostLanding() {
  const { data: info, isPending } = useGuestPostInfo();
  const steps = [
    { icon: FileText, text: m['guest_posts.landing.step_write']() },
    { icon: Search, text: m['guest_posts.landing.step_review']() },
    { icon: Wallet, text: m['guest_posts.landing.step_pay']() },
  ];

  return (
    <section className="px-4 py-20 sm:py-28">
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <h1 className="font-serif text-4xl font-normal tracking-tight sm:text-5xl">
            {m['guest_posts.landing.title']()}
          </h1>
          <p className="text-muted-foreground mx-auto mt-5 max-w-2xl">
            {m['guest_posts.landing.description']()}
          </p>
        </div>

        {!isPending && !info?.enabled ? (
          <p className="text-muted-foreground mt-12 text-center">
            {m['guest_posts.closed']()}
          </p>
        ) : (
          <>
            <ol className="mt-14 grid gap-4 sm:grid-cols-3">
              {steps.map((s, i) => (
                <li key={i} className="rounded-2xl border p-5">
                  <s.icon className="text-muted-foreground size-5" />
                  <p className="mt-3 text-sm">
                    <span className="font-medium">{i + 1}. </span>
                    {s.text}
                  </p>
                </li>
              ))}
            </ol>

            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {(info?.packages ?? []).map((p) => (
                <div
                  key={p.productId}
                  className="flex flex-col rounded-2xl border p-6"
                >
                  <p className="font-medium">{p.planName}</p>
                  <p className="mt-2 text-3xl font-semibold">
                    {formatPrice(p.priceInCents, p.currency)}
                  </p>
                  <ul className="text-muted-foreground mt-4 space-y-2 text-sm">
                    {[
                      m['guest_posts.package_links']({ count: p.maxLinks }),
                      m['guest_posts.landing.perk_permanent'](),
                      m['guest_posts.landing.perk_review'](),
                    ].map((perk) => (
                      <li key={perk} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0" />
                        {perk}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={`/settings/guest-posts/new?package=${encodeURIComponent(p.productId)}`}
                    className={cn(buttonVariants(), 'mt-6')}
                  >
                    {m['guest_posts.landing.cta']()}
                  </Link>
                </div>
              ))}
            </div>

            <p className="text-muted-foreground mt-6 text-center text-xs">
              {m['guest_posts.landing.disclosure']()}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
