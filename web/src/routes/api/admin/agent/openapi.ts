import { createFileRoute } from '@tanstack/react-router';
import { authenticateAdmin } from '@/server/admin/auth';
import { adminOpenApi } from '@/server/admin/discovery';
import { adminErrorResponse } from '@/server/admin/execute';

export const Route = createFileRoute('/api/admin/agent/openapi')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return Response.json(adminOpenApi(await authenticateAdmin(request)), {
            headers: { 'Cache-Control': 'no-store' },
          });
        } catch (error) {
          return adminErrorResponse(error);
        }
      },
    },
  },
});
