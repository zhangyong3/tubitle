import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/orders/refund')({
  server: {
    handlers: {
      POST: (context) => runAdminRoute('orders_refund', context),
    },
  },
});
