import { ArrowRight } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { m } from '@/paraglide/messages.js';

export function CTA() {
  return (
    <section className="tt-container tt-final-cta">
      <p className="tt-eyebrow">{m['tubitle.hero.eyebrow']()}</p>
      <h2>{m['landing.cta.headline']()}</h2>
      <p>{m['landing.cta.subheadline']()}</p>
      <Link href="/settings" className="tt-button">
        {m['landing.cta.button']()}
        <ArrowRight size={18} />
      </Link>
      <span className="tt-final-mark" aria-hidden="true">
        ▶
        <i>
          subtitles on.
          <br />
          possibilities open.
        </i>
      </span>
    </section>
  );
}
