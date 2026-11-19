import { useState } from 'react';
import {
  ArrowRight,
  Captions,
  History,
  ScanText,
  Search,
  ArrowUpRight,
} from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { m } from '@/paraglide/messages.js';

export function ProductTour() {
  const [active, setActive] = useState(0);
  const items = [
    {
      icon: Captions,
      label: m['tubitle.showcase.tag1'](),
      title: m['tubitle.showcase.subTitle'](),
      text: m['tubitle.showcase.subText'](),
      detail: m['tubitle.showcase.subDetail'](),
      image: 'subtitles.jpg',
      width: 500,
      height: 700,
    },
    {
      icon: Search,
      label: m['tubitle.showcase.tag2'](),
      title: m['tubitle.showcase.wordTitle'](),
      text: m['tubitle.showcase.wordText'](),
      detail: m['tubitle.showcase.wordDetail'](),
      image: 'dictionary.jpg',
      width: 500,
      height: 700,
    },
    {
      icon: ScanText,
      label: m['tubitle.showcase.tag3'](),
      title: m['tubitle.showcase.sentenceTitle'](),
      text: m['tubitle.showcase.sentenceText'](),
      detail: m['tubitle.showcase.sentenceDetail'](),
      image: 'sentence-analysis-panel-v2.jpg',
      width: 533,
      height: 766,
    },
    {
      icon: History,
      label: m['tubitle.showcase.history'](),
      title: m['tubitle.showcase.historyTitle'](),
      text: m['tubitle.showcase.historyText'](),
      detail: m['tubitle.showcase.historyDetail'](),
      image: 'history-panel.jpg',
      width: 532,
      height: 757,
    },
  ];
  return (
    <>
      <section id="product-tour" className="tt-section tt-container tt-tour">
        <div className="tt-section-heading">
          <div>
            <p className="tt-eyebrow">{m['tubitle.showcase.eyebrow']()}</p>
            <h2>{m['tubitle.showcase.title']()}</h2>
          </div>
        </div>
        <div
          className="tt-tour-tabs"
          role="tablist"
          aria-label={m['tubitle.showcase.title']()}
        >
          {items.map((item, i) => (
            <button
              key={item.image}
              id={`tour-tab-${i}`}
              type="button"
              role="tab"
              aria-selected={active === i}
              aria-controls={`tour-panel-${i}`}
              tabIndex={active === i ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => {
                let next = i;
                if (e.key === 'ArrowRight') next = (i + 1) % items.length;
                else if (e.key === 'ArrowLeft')
                  next = (i + items.length - 1) % items.length;
                else if (e.key === 'Home') next = 0;
                else if (e.key === 'End') next = items.length - 1;
                else return;
                e.preventDefault();
                setActive(next);
                document.getElementById(`tour-tab-${next}`)?.focus();
              }}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </div>
        <div className="tt-tour-panels">
          {items.map((selected, i) => (
            <div
              key={selected.image}
              id={`tour-panel-${i}`}
              role="tabpanel"
              aria-labelledby={`tour-tab-${i}`}
              className="tt-tour-panel"
              aria-hidden={active !== i}
              inert={active !== i}
            >
              <div className="tt-tour-copy">
                <span className="tt-section-number">0{i + 1} / 04</span>
                <h3>{selected.title}</h3>
                <p>{selected.text}</p>
                <div className="tt-tour-detail">
                  <selected.icon size={20} />
                  <p>{selected.detail}</p>
                </div>
                <Link href="/settings" className="tt-text-link">
                  {m['tubitle.showcase.try']()}
                  <ArrowRight size={17} />
                </Link>
                {i === 1 && (
                  <div>
                    <Link href="/offline-dictionary" className="tt-text-link">
                      {m['tubitle.dictionaryGuide.nav']()}
                    </Link>
                  </div>
                )}
              </div>
              <figure className="tt-tour-figure">
                <a
                  href={`/images/product/${selected.image}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={`/images/product/${selected.image}`}
                    alt={selected.title}
                    width={selected.width}
                    height={selected.height}
                    loading="lazy"
                  />
                </a>
                <figcaption>{m['tubitle.showcase.real']()}</figcaption>
              </figure>
            </div>
          ))}
        </div>
      </section>
      <section className="tt-section tt-container tt-library-story">
        <div className="tt-section-heading">
          <p className="tt-eyebrow">{m['tubitle.showcase.libraryEyebrow']()}</p>
          <h2>{m['tubitle.showcase.libraryTitle']()}</h2>
        </div>
        <div className="tt-library-evidence">
          <figure>
            <a
              href="/images/product/library-review.jpg"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                src="/images/product/library-review.jpg"
                width="1676"
                height="1008"
                loading="lazy"
                alt={m['tubitle.showcase.sentenceTitle']()}
              />
            </a>
            <figcaption>{m['tubitle.showcase.analysisCaption']()}</figcaption>
          </figure>
          <div className="tt-library-list">
            {[
              m['tubitle.showcase.library1'](),
              m['tubitle.showcase.library2'](),
              m['tubitle.showcase.library3'](),
              m['tubitle.showcase.library4'](),
            ].map((text, i) => (
              <div key={text}>
                <span>0{i + 1}</span>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="tt-section tt-container tt-interests">
        <p className="tt-eyebrow">{m['tubitle.showcase.interestsEyebrow']()}</p>
        <h2>{m['tubitle.showcase.interestsTitle']()}</h2>
        <div className="tt-interest-list">
          {[
            { text: m['tubitle.showcase.interest1'](), name: "Luke's English Podcast", handle: 'LukesEnglishPodcast' },
            { text: m['tubitle.showcase.interest2'](), name: 'Stanford Online', handle: 'stanfordonline' },
            { text: m['tubitle.showcase.interest3'](), name: 'BBC Earth', handle: 'bbcearth' },
          ].map(({ text, name, handle }, i) => (
            <div key={text}>
              <span>
                {['01 / PODCASTS', '02 / KNOWLEDGE', '03 / EVERYDAY LIFE'][i]}
              </span>
              <h3>{text.split('|')[0]}</h3>
              <p>{text.split('|')[1]}</p>
              <a
                className="tt-channel-example"
                href={`https://www.youtube.com/@${handle}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${name} · ${m['tubitle.showcase.channelVisit']()}`}
              >
                <img
                  src={`/images/channels/${handle.toLowerCase()}.jpg`}
                  alt={`${name} logo`}
                  width="48"
                  height="48"
                  loading="lazy"
                />
                <span className="tt-channel-copy">
                  <small>{m['tubitle.showcase.channelExample']()}</small>
                  <strong>{name}</strong>
                </span>
                <ArrowUpRight size={17} aria-hidden="true" />
              </a>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
