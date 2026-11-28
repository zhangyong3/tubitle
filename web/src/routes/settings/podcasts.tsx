import { createFileRoute } from '@tanstack/react-router';

import { PodcastLibrary } from '@/blocks/podcast-library';

export const Route = createFileRoute('/settings/podcasts')({
  component: PodcastLibrary,
  head: () => ({ meta: [{ name: 'robots', content: 'noindex' }] }),
});
