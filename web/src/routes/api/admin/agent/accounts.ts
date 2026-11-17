import { createFileRoute } from '@tanstack/react-router';
import { adminErrorResponse, readAdminJson } from '@/server/admin/execute';
import {
  accessErrorToAdmin,
  requireCredentialOwner,
} from '@/server/admin/owner';
import { z } from 'zod';

import {
  createAgent,
  deleteAgent,
  listAgents,
  updateAgent,
} from '@/modules/admin-access/service';
import { respData, respOk } from '@/lib/resp';

const id = z.string().min(1).max(191);
const name = z.string().trim().min(1).max(100);
const roleIds = z.array(id).max(50);
const noStore = { headers: { 'Cache-Control': 'no-store' } };

async function run(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (error) {
    return adminErrorResponse(accessErrorToAdmin(error));
  }
}

export const Route = createFileRoute('/api/admin/agent/accounts')({
  server: {
    handlers: {
      GET: ({ request }) =>
        run(async () => {
          await requireCredentialOwner(request);
          return respData(await listAgents(), noStore);
        }),
      POST: ({ request }) =>
        run(async () => {
          const actor = await requireCredentialOwner(request);
          const body = z
            .object({ name, roleIds })
            .strict()
            .parse(await readAdminJson(request));
          return respData(
            await createAgent({
              ...body,
              operatorPermissions: actor.permissions,
            }),
            noStore
          );
        }),
      PATCH: ({ request }) =>
        run(async () => {
          const actor = await requireCredentialOwner(request);
          const body = z
            .object({ id, name: name.optional(), roleIds: roleIds.optional() })
            .strict()
            .parse(await readAdminJson(request));
          await updateAgent({
            ...body,
            operatorPermissions: actor.permissions,
          });
          return respOk();
        }),
      DELETE: ({ request }) =>
        run(async () => {
          await requireCredentialOwner(request);
          await deleteAgent(
            id.parse(new URL(request.url).searchParams.get('id'))
          );
          return respOk();
        }),
    },
  },
});
