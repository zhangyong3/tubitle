import { createFileRoute } from '@tanstack/react-router';
import { handlePodcasts } from '@/server/podcasts/api';

export const Route = createFileRoute('/api/podcasts/$id')({
  server: {
    handlers: {
      GET: ({ request, params }) => handlePodcasts(request, params.id),
      POST: ({ request, params }) => handlePodcasts(request, params.id),
      PUT: ({ request, params }) => handlePodcasts(request, params.id),
      DELETE: ({ request, params }) => handlePodcasts(request, params.id),
    },
  },
});
