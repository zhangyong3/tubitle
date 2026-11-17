import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/config')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('settings_get', context),
      POST: (context) => runAdminRoute('settings_update', context),
    },
  },
});
