import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/roles/assign')({
  server: {
    handlers: {
      POST: (context) => runAdminRoute('roles_assign', context),
      DELETE: (context) => runAdminRoute('roles_unassign', context),
    },
  },
});
