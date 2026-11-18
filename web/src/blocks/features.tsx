import { Bookmark, Captions, RotateCcw } from 'lucide-react';

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
    </>
  );
}
