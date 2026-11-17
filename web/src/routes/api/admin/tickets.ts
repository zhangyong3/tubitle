import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/tickets')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('tickets_list', context),
    },
  },
});
