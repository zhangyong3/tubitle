import { createFileRoute } from '@tanstack/react-router';
import { handlePodcasts } from '@/server/podcasts/api';

export const Route = createFileRoute('/api/podcasts/$id/audio/$segment')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handlePodcasts(request, params.id, params.segment),
    },
  },
});
