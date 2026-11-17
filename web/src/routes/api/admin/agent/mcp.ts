import { createFileRoute } from '@tanstack/react-router';
import { handleAdminMcp } from '@/server/admin/mcp';

export const Route = createFileRoute('/api/admin/agent/mcp')({
  server: {
    handlers: {
      POST: ({ request }) => handleAdminMcp(request),
      GET: () =>
        new Response(null, { status: 405, headers: { Allow: 'POST' } }),
      DELETE: () =>
        new Response(null, { status: 405, headers: { Allow: 'POST' } }),
    },
  },
});
