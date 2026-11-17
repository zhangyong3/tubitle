import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/analytics/overview')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('analytics_overview', context),
    },
  },
});
