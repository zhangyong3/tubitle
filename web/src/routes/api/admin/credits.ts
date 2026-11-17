import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/credits')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('credits_list', context),
    },
  },
});
