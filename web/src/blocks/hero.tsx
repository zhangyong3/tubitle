import { ArrowRight } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { m } from '@/paraglide/messages.js';
import { LessonPreview } from '@/blocks/lesson-preview';

export function Hero() {
  return (
    <section className="tt-hero tt-container">
      <div className="tt-hero-copy">
        <p className="tt-eyebrow">
          <span className="tt-dot" />
          {m['tubitle.hero.eyebrow']()}
        </p>
        <h1>{m['tubitle.hero.title']()}</h1>
        <p className="tt-lead">{m['tubitle.hero.description']()}</p>
        <Link href="/settings" className="tt-button">
          {m['tubitle.hero.cta']()}
          <ArrowRight size={18} />
        </Link>
      </div>
      <LessonPreview />
    </section>
  );
}
