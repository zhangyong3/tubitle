import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/users/$id')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('users_get', context),
    },
  },
});
