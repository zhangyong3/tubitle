import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/settings/test')({
  server: {
    handlers: {
      POST: (context) => runAdminRoute('settings_test', context),
    },
  },
});
