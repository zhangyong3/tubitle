import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/users/timeline')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('users_timeline', context),
    },
  },
});
