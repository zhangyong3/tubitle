import { createFileRoute } from '@tanstack/react-router';
import { authenticateAdmin, requirePermission } from '@/server/admin/auth';
import { adminErrorResponse } from '@/server/admin/execute';
import { z } from 'zod';

import { listExecutions } from '@/modules/admin-access/service';
import { respData } from '@/lib/resp';

export const Route = createFileRoute('/api/admin/agent/audit')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const actor = await authenticateAdmin(request);
          requirePermission(actor, 'admin.*');
          const input = z
            .object({
              page: z.coerce.number().int().positive().default(1),
              pageSize: z.coerce.number().int().min(1).max(100).default(20),
              userId: z.string().min(1).max(191).optional(),
              // Default: only calls made with agent keys; `all` adds the
              // journaled browser-admin actions too.
              scope: z.enum(['agents', 'all']).default('agents'),
            })
            .parse(Object.fromEntries(new URL(request.url).searchParams));
          return respData(
            // Browser admins see every agent's history (optionally one
            // agent's); an agent key only ever sees its own.
            await listExecutions({
              userId: actor.tokenId ? actor.userId : input.userId,
              agentsOnly: !actor.tokenId && input.scope === 'agents',
              page: input.page,
              pageSize: input.pageSize,
            }),
            { headers: { 'Cache-Control': 'no-store' } }
          );
        } catch (error) {
          return adminErrorResponse(error);
        }
      },
    },
  },
});
