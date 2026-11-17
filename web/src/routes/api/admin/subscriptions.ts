import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/subscriptions')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('subscriptions_list', context),
    },
  },
});
