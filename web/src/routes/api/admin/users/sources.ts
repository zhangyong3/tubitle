import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/users/sources')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('users_sources', context),
    },
  },
});
