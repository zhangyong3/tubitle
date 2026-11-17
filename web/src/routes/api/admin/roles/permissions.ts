import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/roles/permissions')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('roles_permissions_get', context),
      PUT: (context) => runAdminRoute('roles_permissions_update', context),
    },
  },
});
