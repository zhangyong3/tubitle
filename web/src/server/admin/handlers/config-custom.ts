import {
  getCustomConfigs,
  replaceCustomConfigs,
  type CustomConfig,
} from '@/modules/config/service';
import { respData, respErr, respOk } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

const noStore = {
  headers: {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  },
};

export async function GET({ request, actor }: AdminHandlerContext) {
  try {
    const configs = await getCustomConfigs();
    return respData(configs, noStore);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function POST({ request, actor }: AdminHandlerContext) {
  try {
    const body = await request.json();
    const configs: CustomConfig[] = Array.isArray(body?.configs)
      ? body.configs
      : [];

    await replaceCustomConfigs(configs);
    return respOk(noStore);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
