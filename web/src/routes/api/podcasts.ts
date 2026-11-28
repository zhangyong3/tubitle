import { createFileRoute } from '@tanstack/react-router';
import { handlePodcasts } from '@/server/podcasts/api';

export const Route = createFileRoute('/api/podcasts')({
  server: {
    handlers: {
      GET: ({ request }) => handlePodcasts(request),
      POST: ({ request }) => handlePodcasts(request),
      PATCH: ({ request }) => handlePodcasts(request),
    },
  },
});
