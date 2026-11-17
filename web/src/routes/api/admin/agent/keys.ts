import { createFileRoute } from '@tanstack/react-router';
import { adminErrorResponse, readAdminJson } from '@/server/admin/execute';
import {
  accessErrorToAdmin,
  requireCredentialOwner,
} from '@/server/admin/owner';
import { AdminError } from '@/server/admin/types';
import { z } from 'zod';

import { createAgentKey, revokeAgentKey } from '@/modules/admin-access/service';
import { respData, respOk } from '@/lib/resp';

const id = z.string().min(1).max(191);

export const Route = createFileRoute('/api/admin/agent/keys')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireCredentialOwner(request);
          const body = z
            .object({
              agentId: id,
              name: z.string().trim().min(1).max(100),
              // null = never expires; otherwise within the next 365 days.
              expiresAt: z.iso.datetime({ offset: true }).nullable(),
            })
            .strict()
            .parse(await readAdminJson(request));
          const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
          if (
            expiresAt &&
            (expiresAt <= new Date() ||
              expiresAt.getTime() > Date.now() + 365 * 86400000)
          )
            throw new AdminError('Expiry must be within the next 365 days');
          // The key is returned exactly once; only its hash is stored.
          return respData(await createAgentKey({ ...body, expiresAt }), {
            headers: { 'Cache-Control': 'no-store' },
          });
        } catch (error) {
          return adminErrorResponse(accessErrorToAdmin(error));
        }
      },
      DELETE: async ({ request }) => {
        try {
          await requireCredentialOwner(request);
          await revokeAgentKey(
            id.parse(new URL(request.url).searchParams.get('id'))
          );
          return respOk();
        } catch (error) {
          return adminErrorResponse(accessErrorToAdmin(error));
        }
      },
    },
  },
});
