import { ArrowDown, ArrowRight, BookOpen } from 'lucide-react';

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
        <a href="#preview" className="tt-text-link">
          {m['tubitle.hero.secondary']()}
          <ArrowDown size={16} />
        </a>
        <p className="tt-fine">
          <BookOpen size={15} />
          {m['tubitle.hero.note']()}
        </p>
      </div>
      <LessonPreview />
    </section>
  );
}
