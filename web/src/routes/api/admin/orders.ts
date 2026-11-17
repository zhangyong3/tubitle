import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/orders')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('orders_list', context),
      PATCH: (context) => runAdminRoute('orders_update', context),
    },
  },
});
