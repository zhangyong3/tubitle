import { AccessError } from '@/modules/admin-access/service';

import {
  authenticateAdmin,
  checkSessionOrigin,
  requirePermission,
} from './auth';
import { AdminError } from './types';

/**
 * Credential administration is a separate control plane: only a full admin
 * (`admin.*`) in a same-origin browser session — never an agent key — may
 * create agents, change their roles, or mint/revoke their keys.
 */
export async function requireCredentialOwner(request: Request) {
  const actor = await authenticateAdmin(request);
  if (actor.tokenId)
    throw new AdminError(
      'Use an administrator browser session to manage agents and keys',
      403
    );
  requirePermission(actor, 'admin.*');
  checkSessionOrigin(request, actor);
  return actor;
}

export function accessErrorToAdmin(error: unknown) {
  return error instanceof AccessError ? new AdminError(error.message) : error;
}
