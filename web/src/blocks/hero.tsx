import { ArrowDown, ArrowRight, Captions, Check } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { m } from '@/paraglide/messages.js';

export function Hero() {
  return (
    <section className="tt-container tt-home-hero">
      <div className="tt-home-hero-top">
        <div>
          <p className="tt-eyebrow">
            <span className="tt-dot" />
            {m['tubitle.hero.eyebrow']()}
          </p>
          <h1>{m['tubitle.hero.title']()}</h1>
        </div>
        <div className="tt-home-intro">
          <p className="tt-lead">{m['tubitle.hero.description']()}</p>
          <Link href="/settings" className="tt-button">
            {m['tubitle.hero.cta']()}
            <ArrowRight size={18} />
          </Link>
          <a href="#product-tour" className="tt-text-link">
            {m['tubitle.showcase.explore']()}
            <ArrowDown size={16} />
          </a>
          <p className="tt-fine">
            <Check size={14} />
            {m['tubitle.showcase.browser']()}
          </p>
        </div>
      </div>
      <figure className="tt-hero-product">
        <div className="tt-product-bar">
          <span className="tt-preview-dots">
            <i />
            <i />
            <i />
          </span>
          <span>
            youtube.com <span className="tt-url-divider">/</span>{' '}
            {m['tubitle.showcase.workspace']()}
          </span>
          <Captions size={16} />
        </div>
        <img
          src="/images/product/workspace-bbc-earth.jpg"
          alt={m['tubitle.showcase.workspaceAlt']()}
          width="1765"
          height="702"
          fetchPriority="high"
        />
        <figcaption>
          <span>
            <span className="tt-live-dot" />
            {m['tubitle.showcase.real']()}
          </span>
          <span>{m['tubitle.showcase.heroCaption']()}</span>
        </figcaption>
      </figure>
      <div className="tt-capability-strip">
        {[
          m['tubitle.showcase.tag1'](),
          m['tubitle.showcase.tag2'](),
          m['tubitle.showcase.tag3'](),
          m['tubitle.showcase.tag4'](),
        ].map((text, i) => (
          <span key={text}>
            <small>0{i + 1}</small>
            {text}
          </span>
        ))}
      </div>
    </section>
  );
}
