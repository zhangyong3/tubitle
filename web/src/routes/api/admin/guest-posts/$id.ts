import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/guest-posts/$id')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('guest_posts_get', context),
      POST: (context) => runAdminRoute('guest_posts_review', context),
      PUT: (context) => runAdminRoute('guest_posts_update', context),
      PATCH: (context) => runAdminRoute('guest_posts_unpublish', context),
    },
  },
});
