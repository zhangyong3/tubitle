import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Captions,
  Check,
  Languages,
} from 'lucide-react';

import { m } from '@/paraglide/messages.js';

export function LessonPreview() {
  const [translation, setTranslation] = useState(true);
  const [definition, setDefinition] = useState(false);
  const [index, setIndex] = useState(0);
  const next = () => {
    setIndex((n) => 1 - n);
    setDefinition(false);
  };
  return (
    <div id="preview" className="tt-preview">
      <div className="tt-preview-top">
        <span className="tt-preview-dots">
          <i />
          <i />
          <i />
        </span>
        <span>{m['tubitle.demo.label']()}</span>
        <Captions size={17} />
      </div>
      <div className="tt-video-scene" aria-hidden="true">
        <span className="tt-orbit" />
        <span className="tt-scene-word">
          a little
          <br />
          <em>every day.</em>
        </span>
        <span className="tt-scene-index">{index === 0 ? '01' : '02'} / 02</span>
      </div>
      <div className="tt-lesson">
        <div className="tt-lesson-meta">
          <span>{m['tubitle.demo.chapter']()}</span>
          <span>{index === 0 ? '02:14' : '02:21'}</span>
        </div>
        <p className="tt-english" lang="en">
          {index === 0 ? (
            <>
              You don’t have to be great to{' '}
              <button
                onClick={() => setDefinition(!definition)}
                aria-expanded={definition}
              >
                get started
              </button>
              , but you have to get started to be great.
            </>
          ) : (
            <>
              What matters is that you{' '}
              <button
                onClick={() => setDefinition(!definition)}
                aria-expanded={definition}
              >
                show up
              </button>
              , even when progress feels small.
            </>
          )}
        </p>
        {translation && (
          <p className="tt-translation" lang="zh">
            {index === 0
              ? m['tubitle.demo.translation']()
              : m['tubitle.demo.translation2']()}
          </p>
        )}
        {definition && (
          <div className="tt-definition">
            <strong lang="en">{index === 0 ? 'get started' : 'show up'}</strong>
            <p>
              {index === 0
                ? m['tubitle.demo.meaning']()
                : m['tubitle.demo.meaning2']()}
            </p>
            <button onClick={() => setDefinition(false)}>
              {m['tubitle.demo.close']()}
            </button>
          </div>
        )}
        <div className="tt-preview-controls">
          <button onClick={next} aria-label={m['tubitle.demo.previous']()}>
            <ArrowLeft size={18} />
          </button>
          <span>{index + 1} / 2</span>
          <button onClick={next} aria-label={m['tubitle.demo.next']()}>
            <ArrowRight size={18} />
          </button>
          <button
            className="tt-translation-toggle"
            onClick={() => setTranslation(!translation)}
            aria-pressed={translation}
          >
            <Languages size={16} />
            {translation ? m['tubitle.demo.hide']() : m['tubitle.demo.show']()}
          </button>
        </div>
        <p className="tt-demo-hint">
          <Check size={14} />
          {m['tubitle.demo.wordAction']()}
        </p>
      </div>
      <div className="tt-preview-foot">{m['tubitle.demo.caption']()}</div>
    </div>
  );
}
