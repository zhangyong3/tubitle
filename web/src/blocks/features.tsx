import { ArrowUpRight, Bookmark, Captions, RotateCcw } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { m } from '@/paraglide/messages.js';

export function Features() {
  const steps = [
    {
      icon: Captions,
      title: m['tubitle.flow.1.title'](),
      text: m['tubitle.flow.1.description'](),
    },
    {
      icon: Bookmark,
      title: m['tubitle.flow.2.title'](),
      text: m['tubitle.flow.2.description'](),
    },
    {
      icon: RotateCcw,
      title: m['tubitle.flow.3.title'](),
      text: m['tubitle.flow.3.description'](),
    },
  ];
  return (
    <>
      <section id="features" className="tt-section tt-container">
        <p className="tt-eyebrow">{m['tubitle.flow.eyebrow']()}</p>
        <h2>{m['tubitle.flow.title']()}</h2>
        <div className="tt-steps">
          {steps.map((step, i) => (
            <article key={step.title}>
              <div className="tt-step-index">
                <step.icon size={22} />
                <span>0{i + 1}</span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="tt-feature-band">
        <div className="tt-container tt-feature-layout">
          <div>
            <p className="tt-eyebrow">TUBITLE / YOUR LEARNING NOTEBOOK</p>
            <h2>{m['tubitle.feature.title']()}</h2>
            <p>{m['tubitle.feature.description']()}</p>
            <Link href="/settings" className="tt-text-link">
              {m['tubitle.nav.library']()}
              <ArrowUpRight size={18} />
            </Link>
          </div>
          <div className="tt-feature-notes">
            <article>
              <span className="tt-dot" />
              <h3>{m['tubitle.feature.current']()}</h3>
              <p>{m['tubitle.feature.currentText']()}</p>
            </article>
            <article>
              <span className="tt-dot tt-dot-outline" />
              <h3>{m['tubitle.feature.future']()}</h3>
              <p>{m['tubitle.feature.futureText']()}</p>
            </article>
          </div>
        </div>
      </section>
    </>
  );
}
