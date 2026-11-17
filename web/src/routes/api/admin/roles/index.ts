import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/roles/')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('roles_list', context),
      POST: (context) => runAdminRoute('roles_create', context),
      PUT: (context) => runAdminRoute('roles_update', context),
      DELETE: (context) => runAdminRoute('roles_delete', context),
    },
  },
});
