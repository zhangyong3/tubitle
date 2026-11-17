import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/categories')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('categories_list', context),
      POST: (context) => runAdminRoute('categories_create', context),
      PUT: (context) => runAdminRoute('categories_update', context),
      DELETE: (context) => runAdminRoute('categories_delete', context),
    },
  },
});
