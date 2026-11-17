import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/users/password')({
  server: {
    handlers: {
      POST: (context) => runAdminRoute('users_set_password', context),
    },
  },
});
