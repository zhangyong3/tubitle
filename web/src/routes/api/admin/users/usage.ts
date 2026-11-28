import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/users/usage')({
  server: {
    handlers: { GET: (context) => runAdminRoute('users_usage', context) },
  },
});
