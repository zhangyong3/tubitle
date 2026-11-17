import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/users/credits')({
  server: {
    handlers: {
      POST: (context) => runAdminRoute('credits_adjust', context),
    },
  },
});
