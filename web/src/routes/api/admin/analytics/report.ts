import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/analytics/report')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('analytics_report', context),
    },
  },
});
