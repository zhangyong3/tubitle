import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/invite-codes')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('invite_codes_list', context),
      POST: (context) => runAdminRoute('invite_codes_create', context),
      DELETE: (context) => runAdminRoute('invite_codes_delete', context),
    },
  },
});
