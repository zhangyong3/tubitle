import { ArrowRight, Check } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { m } from '@/paraglide/messages.js';

export function Pricing() {
  const plans = [
    {
      title: m['tubitle.pricing.free'](),
      price: m['tubitle.pricing.freePrice'](),
      description: m['tubitle.pricing.freeDescription'](),
      features: [
        m['tubitle.pricing.free1'](),
        m['tubitle.pricing.free2'](),
        m['tubitle.pricing.free3'](),
        m['tubitle.pricing.free4'](),
      ],
      cta: m['tubitle.pricing.freeCta'](),
    },
    {
      title: m['tubitle.pricing.pro'](),
      price: m['tubitle.pricing.proPrice'](),
      description: m['tubitle.pricing.proDescription'](),
      features: [
        m['tubitle.pricing.pro1'](),
        m['tubitle.pricing.pro2'](),
        m['tubitle.pricing.pro3'](),
      ],
      cta: m['tubitle.pricing.proCta'](),
    },
  ];
  return (
    <section id="plans" className="tt-section tt-container">
      <p className="tt-eyebrow">{m['tubitle.pricing.eyebrow']()}</p>
      <h2>{m['tubitle.pricing.title']()}</h2>
      <p className="tt-section-description">
        {m['tubitle.pricing.description']()}
      </p>
      <div className="tt-plans">
        {plans.map((plan, i) => (
          <article
            key={plan.title}
            className={i === 1 ? 'tt-plan tt-plan-pro' : 'tt-plan'}
          >
            <div className="tt-plan-name">
              {plan.title}
              <span>0{i + 1}</span>
            </div>
            <p className="tt-plan-description">{plan.description}</p>
            <p className="tt-plan-price">{plan.price}</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Check size={17} />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/sign-up?callbackUrl=%2Fsettings"
              className={i ? 'tt-button tt-button-secondary' : 'tt-button'}
            >
              {plan.cta}
              <ArrowRight size={17} />
            </Link>
          </article>
        ))}
      </div>
      <p className="tt-plan-note">{m['tubitle.pricing.note']()}</p>
    </section>
  );
}
