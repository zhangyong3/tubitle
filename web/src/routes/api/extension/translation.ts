import { createFileRoute } from '@tanstack/react-router';
import { handleExtensionTranslation } from '@/server/translation/api';

export const Route = createFileRoute('/api/extension/translation')({
  server: {
    handlers: {
      GET: ({ request }) => handleExtensionTranslation(request),
      POST: ({ request }) => handleExtensionTranslation(request),
    },
  },
});
