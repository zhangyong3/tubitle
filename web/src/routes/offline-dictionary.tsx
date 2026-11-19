import { createFileRoute } from '@tanstack/react-router';
import { BookOpen, FolderOpen, HardDrive, Search } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';

export const Route = createFileRoute('/offline-dictionary')({
  loader: () => {
    const locale = getLocale();
    return {
      title: m['tubitle.dictionaryGuide.title']({}, { locale }),
      description: m['tubitle.dictionaryGuide.description']({}, { locale }),
    };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.title} | Tubitle` },
          { name: 'description', content: loaderData.description },
        ]
      : [],
  }),
  component: OfflineDictionaryGuide,
});

function OfflineDictionaryGuide() {
  const sections = [
    { id: 'benefits', label: m['tubitle.dictionaryGuide.benefits']() },
    { id: 'resources', label: m['tubitle.dictionaryGuide.resources']() },
    { id: 'files', label: m['tubitle.dictionaryGuide.files']() },
    { id: 'import', label: m['tubitle.dictionaryGuide.import']() },
    { id: 'troubleshooting', label: m['tubitle.dictionaryGuide.trouble']() },
  ];
  const benefits = [
    {
      icon: Search,
      title: m['tubitle.dictionaryGuide.benefit1.title'](),
      text: m['tubitle.dictionaryGuide.benefit1.text'](),
    },
    {
      icon: BookOpen,
      title: m['tubitle.dictionaryGuide.benefit2.title'](),
      text: m['tubitle.dictionaryGuide.benefit2.text'](),
    },
    {
      icon: HardDrive,
      title: m['tubitle.dictionaryGuide.benefit3.title'](),
      text: m['tubitle.dictionaryGuide.benefit3.text'](),
    },
  ];
  const steps = [
    {
      title: m['tubitle.dictionaryGuide.step1.title'](),
      text: m['tubitle.dictionaryGuide.step1.text'](),
    },
    {
      title: m['tubitle.dictionaryGuide.step2.title'](),
      text: m['tubitle.dictionaryGuide.step2.text'](),
    },
    {
      title: m['tubitle.dictionaryGuide.step3.title'](),
      text: m['tubitle.dictionaryGuide.step3.text'](),
    },
    {
      title: m['tubitle.dictionaryGuide.step4.title'](),
      text: m['tubitle.dictionaryGuide.step4.text'](),
    },
  ];
  const troubleshooting = [
    {
      title: m['tubitle.dictionaryGuide.trouble1.title'](),
      text: m['tubitle.dictionaryGuide.trouble1.text'](),
    },
    {
      title: m['tubitle.dictionaryGuide.trouble2.title'](),
      text: m['tubitle.dictionaryGuide.trouble2.text'](),
    },
    {
      title: m['tubitle.dictionaryGuide.trouble3.title'](),
      text: m['tubitle.dictionaryGuide.trouble3.text'](),
    },
    {
      title: m['tubitle.dictionaryGuide.trouble4.title'](),
      text: m['tubitle.dictionaryGuide.trouble4.text'](),
    },
  ];
  return (
    <div className="tt-marketing bg-background text-foreground">
      <Header />
      <main id="main-content" className="tt-container tt-dictionary-guide">
        <header className="tt-guide-heading">
          <p className="tt-eyebrow">{m['tubitle.dictionaryGuide.eyebrow']()}</p>
          <h1>{m['tubitle.dictionaryGuide.title']()}</h1>
          <p>{m['tubitle.dictionaryGuide.intro']()}</p>
        </header>
        <div className="tt-guide-layout">
          <aside>
            <nav aria-label={m['tubitle.dictionaryGuide.toc']()}>
              <p className="tt-eyebrow">{m['tubitle.dictionaryGuide.toc']()}</p>
              {sections.map(({ id, label }) => (
                <a key={id} href={`#${id}`}>
                  {label}
                </a>
              ))}
            </nav>
          </aside>
          <article className="tt-guide-body">
            <section id="benefits">
              <h2>{sections[0].label}</h2>
              <div className="tt-guide-benefits">
                {benefits.map(({ icon: Icon, title, text }) => (
                  <div key={title}>
                    <Icon size={22} aria-hidden="true" />
                    <div>
                      <h3>{title}</h3>
                      <p>{text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="tt-guide-note">
                {m['tubitle.dictionaryGuide.boundary']()}
              </p>
            </section>
            <section id="resources">
              <h2>{sections[1].label}</h2>
              <p>{m['tubitle.dictionaryGuide.resourceIntro']()}</p>
              <div className="tt-guide-resource">
                <a
                  href="https://downloads.freemdict.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {m['tubitle.dictionaryGuide.freemdict']()}
                </a>
                <p>{m['tubitle.dictionaryGuide.freemdictText']()}</p>
              </div>
              <div className="tt-guide-resource">
                <a
                  href="https://www.google.com/search?q=MDict+MDX+dictionary+download"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {m['tubitle.dictionaryGuide.google']()}
                </a>
                <p>{m['tubitle.dictionaryGuide.googleText']()}</p>
              </div>
              <p className="tt-guide-note">
                {m['tubitle.dictionaryGuide.resourceNote']()}
              </p>
            </section>
            <section id="files">
              <h2>{sections[2].label}</h2>
              <p>{m['tubitle.dictionaryGuide.fileIntro']()}</p>
              <div className="tt-guide-folder">
                <FolderOpen size={18} aria-hidden="true" /> MDict / dictionary
              </div>
              <pre className="tt-guide-tree">
                <code>
                  {
                    'MyDictionary/\n├── dictionary.mdx\n├── dictionary.css\n├── dictionary.1.mdd\n└── dictionary.2.mdd'
                  }
                </code>
              </pre>
              <dl className="tt-guide-file-types">
                {[
                  ['.mdx', m['tubitle.dictionaryGuide.mdx']()],
                  ['.css', m['tubitle.dictionaryGuide.css']()],
                  ['.mdd', m['tubitle.dictionaryGuide.mdd']()],
                ].map(([type, text]) => (
                  <div key={type}>
                    <dt>
                      <code>{type}</code>
                    </dt>
                    <dd>{text}</dd>
                  </div>
                ))}
              </dl>
              <p>{m['tubitle.dictionaryGuide.fileNote']()}</p>
              <p className="tt-guide-note">
                {m['tubitle.dictionaryGuide.compatibility']()}
              </p>
            </section>
            <section id="import">
              <h2>{sections[3].label}</h2>
              <ol className="tt-guide-steps">
                {steps.map(({ title, text }) => (
                  <li key={title}>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </li>
                ))}
              </ol>
              <p className="tt-guide-note">
                {m['tubitle.dictionaryGuide.replace']()}
              </p>
            </section>
            <section id="troubleshooting">
              <h2>{sections[4].label}</h2>
              {troubleshooting.map(({ title, text }) => (
                <div className="tt-guide-trouble" key={title}>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </section>
            <div className="tt-guide-end">
              <p>{m['tubitle.dictionaryGuide.cta']()}</p>
              <Link href="/" className="tt-button">
                {m['tubitle.dictionaryGuide.back']()}
              </Link>
            </div>
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
}
