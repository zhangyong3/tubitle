import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/config/custom')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('custom_settings_get', context),
      POST: (context) => runAdminRoute('custom_settings_replace', context),
    },
  },
});
