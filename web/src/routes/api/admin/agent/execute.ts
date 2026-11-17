import { createFileRoute } from '@tanstack/react-router';
import { authenticateAdmin, checkSessionOrigin } from '@/server/admin/auth';
import {
  adminErrorResponse,
  executeAdmin,
  findOperation,
  readAdminJson,
} from '@/server/admin/execute';
import { z } from 'zod';

const schema = z
  .object({
    operation: z.string(),
    input: z.record(z.string(), z.unknown()).default({}),
    idempotencyKey: z.string().optional(),
  })
  .strict();
export const Route = createFileRoute('/api/admin/agent/execute')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const actor = await authenticateAdmin(request);
          checkSessionOrigin(request, actor);
          const body = schema.parse(await readAdminJson(request));
          return await executeAdmin(
            findOperation(body.operation),
            body.input,
            actor,
            body.idempotencyKey || request.headers.get('idempotency-key')
          );
        } catch (error) {
          return adminErrorResponse(error);
        }
      },
    },
  },
});
