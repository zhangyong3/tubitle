import { createFileRoute } from '@tanstack/react-router';

import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { LearningLibrary } from '@/blocks/learning-library';

export const Route = createFileRoute('/settings/')({
  loader: () => ({
    title: m['tubitle.library.title']({}, { locale: getLocale() }),
  }),
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.title },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  component: LearningLibrary,
});
