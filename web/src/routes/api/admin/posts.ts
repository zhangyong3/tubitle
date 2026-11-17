import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/posts')({
  server: {
    handlers: {
      GET: (context) => runAdminRoute('posts_list', context),
      POST: (context) => runAdminRoute('posts_create', context),
      PUT: (context) => runAdminRoute('posts_update', context),
      DELETE: (context) => runAdminRoute('posts_delete', context),
    },
  },
});
