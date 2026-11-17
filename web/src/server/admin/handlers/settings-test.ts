import {
  assertEndpointSecretsResupplied,
  getAllConfigs,
  isMaskedConfigValue,
} from '@/modules/config/service';
import { getTestSpec, runTest } from '@/modules/config/settings-test';
import {
  sendTestGuestPostNotification,
  sendTestPaymentNotification,
  sendTestTicketNotification,
} from '@/modules/notify/service';
import { respData, respErr } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

export async function POST({ request, actor }: AdminHandlerContext) {
  try {
    const body = await request.json();
    const group: string = body?.group;
    const inputs: Record<string, string> = body?.inputs || {};
    const overrides: Record<string, string> = body?.configs || {};
    if (!group) return respErr('group is required');

    const spec = getTestSpec(group);
    if (!spec) return respErr(`No test available for "${group}"`);

    for (const field of spec.fields) {
      if (field.required && !inputs[field.name]) {
        return respErr(`Missing required field: ${field.label}`);
      }
    }

    // Test against the values currently entered in the form (possibly unsaved),
    // falling back to saved config. Masked secrets mean "unchanged" — skip them
    // so the real saved value applies instead of the bullet placeholder.
    const configs = await getAllConfigs();
    // A test must not send a saved secret to an endpoint that isn't saved.
    assertEndpointSecretsResupplied(overrides, configs);
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === 'string' && !isMaskedConfigValue(value)) {
        configs[key] = value;
      }
    }

    // Notify tests live in the notify module (config can't import it).
    if (group.startsWith('notify_')) {
      const channel = group.slice('notify_'.length);
      // The settings group previews every message kind on every bot.
      const results =
        channel === 'settings'
          ? [
              ...(await sendTestPaymentNotification(configs)),
              ...(await sendTestTicketNotification(configs)),
              ...(await sendTestGuestPostNotification(configs)),
            ]
          : await sendTestPaymentNotification(configs, channel as any);
      const failed = results.filter((r) => !r.success);
      return respData({
        success: failed.length === 0,
        message:
          failed.length === 0
            ? `Sent to ${[...new Set(results.map((r) => r.channel))].join(', ')}`
            : failed.map((r) => `${r.channel}: ${r.error}`).join('\n'),
        // A channel reports its first failure, if any.
        details: Object.fromEntries(
          [...results]
            .sort((a, b) => Number(b.success) - Number(a.success))
            .map((r) => [r.channel, r.success ? 'ok' : r.error || 'failed'])
        ),
      });
    }

    const result = await runTest(group, inputs, configs);
    return respData(result);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
