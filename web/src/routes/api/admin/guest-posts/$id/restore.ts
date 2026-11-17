import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/guest-posts/$id/restore')({
  server: {
    handlers: {
      POST: (context) => runAdminRoute('guest_posts_restore', context),
    },
  },
});
