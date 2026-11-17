import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/tickets/$id')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('tickets_get', context),
      POST: (context) => runAdminRoute('tickets_reply', context),
      PATCH: (context) => runAdminRoute('tickets_update', context),
    },
  },
});
