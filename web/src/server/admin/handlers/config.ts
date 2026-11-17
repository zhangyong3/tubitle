import {
  getAdminConfigs,
  getAllConfigs,
  saveConfigs,
} from '@/modules/config/service';
import { getRoleByName, roleGrantsAdmin } from '@/modules/rbac/service';
import { isValidEmbedSetting } from '@/lib/embed-ids';
import { respData, respErr, respOk } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

const noStore = {
  headers: {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  },
};

export async function GET({ request, actor }: AdminHandlerContext) {
  try {
    // Masked + protected-keys-stripped view — never send raw configs to a client.
    const configs = await getAdminConfigs();
    return respData(configs, noStore);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function POST({ request, actor }: AdminHandlerContext) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') return respErr('Invalid body');

    // The signup role goes to every new account, so it may never be an admin
    // role — otherwise settings.write alone escalates to super_admin.
    const roleName = body.initial_role_name;
    if (typeof roleName === 'string' && roleName.trim()) {
      const found = await getRoleByName(roleName.trim());
      if (found && (await roleGrantsAdmin(found.id))) {
        return respErr(
          `Role "${roleName}" carries admin permissions and cannot be the default role for new users`
        );
      }
    }

    // These values end up inside inline <script> tags / script URLs. Only
    // values being changed are checked: the settings form posts every field
    // of the tab, and a stored value that stopped passing (e.g. a
    // self-hosted Plausible host not yet in PLAUSIBLE_SCRIPT_HOSTS) must not
    // block saving the others. It is still dropped at render.
    const stored = await getAllConfigs();
    for (const [name, value] of Object.entries(body)) {
      if (typeof value !== 'string') continue;
      if (value.trim() === (stored[name] ?? '').trim()) continue;
      if (!isValidEmbedSetting(name, value)) {
        if (name === 'plausible_src') return respErr(plausibleSrcError(value));
        return respErr(`Invalid format for ${name}`);
      }
    }

    await saveConfigs(body);
    return respOk(noStore);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

function plausibleSrcError(value: string) {
  let host = '';
  try {
    host = new URL(value.trim()).hostname;
  } catch {}
  if (!host || !/^https:/i.test(value.trim()))
    return 'plausible_src must be a same-site path (e.g. /js/script.js) or an https URL.';
  return `The Plausible script host ${host} is not allowed. Add PLAUSIBLE_SCRIPT_HOSTS=${host} to the server environment (comma-separate several hosts), then restart or redeploy. No rebuild needed.`;
}
