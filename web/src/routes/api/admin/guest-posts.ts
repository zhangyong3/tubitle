import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/guest-posts')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('guest_posts_list', context),
    },
  },
});
