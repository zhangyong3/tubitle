import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/permissions')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('permissions_list', context),
      POST: (context) => runAdminRoute('permissions_create', context),
      PUT: (context) => runAdminRoute('permissions_update', context),
      DELETE: (context) => runAdminRoute('permissions_delete', context),
    },
  },
});
