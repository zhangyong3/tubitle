import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { permission, role } from '../src/config/db/schema';
import { db } from '../src/core/db';
import { adminScopes } from '../src/lib/admin-operations';
import { getUuid } from '../src/lib/hash';
import {
  createAgent,
  createAgentKey,
  listAgents,
  revokeAgentKey,
} from '../src/modules/admin-access/service';

const USAGE = `Usage: pnpm admin:token <command>

  roles                                         List roles (assign them to agents)
  agents                                        List agent accounts with roles and keys
  create-agent --name=Bot --roles=admin,editor  Create an agent account with RBAC roles
  create --agent=AGENT_ID --name=Key --days=30|never --output=/secure/path/key
                                                Issue an admin API key for an agent
  revoke --id=KEY_ID                            Revoke a key
  sync-permissions                              Register missing admin.* permission rows

Use the database owner environment. Keys are written once to a new mode-0600
file and never printed. Agent permissions come from their roles.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    roles: { type: 'string' },
    agent: { type: 'string' },
    days: { type: 'string', default: '30' },
    output: { type: 'string' },
    id: { type: 'string' },
    help: { type: 'boolean' },
  },
});

async function main() {
  const command = positionals[0];
  if (values.help || !command) {
    console.log(USAGE);
    return;
  }
  if (command === 'sync-permissions') {
    const existing: { code: string }[] = await db()
      .select({ code: permission.code })
      .from(permission);
    const codes = new Set(existing.map((item) => item.code));
    let added = 0;
    for (const code of adminScopes) {
      if (codes.has(code)) continue;
      const [, resource, action] = code.split('.');
      await db()
        .insert(permission)
        .values({
          id: getUuid(),
          code,
          resource,
          action,
          title: `${resource}: ${action}`,
        });
      added++;
    }
    console.log(
      `Registered ${added} missing permissions; role assignments were preserved.`
    );
    return;
  }
  if (command === 'roles') {
    const rows = await db()
      .select({ id: role.id, name: role.name, title: role.title })
      .from(role)
      .where(eq(role.status, 'active'));
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (command === 'agents') {
    console.log(JSON.stringify(await listAgents(), null, 2));
    return;
  }
  if (command === 'create-agent') {
    const name = z.string().trim().min(1).max(100).parse(values.name);
    const names = [...new Set((values.roles || '').split(',').filter(Boolean))];
    if (!names.length) throw new Error('Supply --roles=role_name,...');
    const rows: { id: string; name: string }[] = await db()
      .select({ id: role.id, name: role.name })
      .from(role)
      .where(inArray(role.name, names));
    const missing = names.filter((n) => !rows.some((r) => r.name === n));
    if (missing.length) throw new Error(`Unknown roles: ${missing.join(', ')}`);
    // The database owner is trusted here (bootstrap path), so no ceiling.
    const agent = await createAgent({
      name,
      roleIds: rows.map((r) => r.id),
      operatorPermissions: ['*'],
    });
    console.log(JSON.stringify({ ...agent, roles: names }, null, 2));
    return;
  }
  if (command === 'revoke') {
    await revokeAgentKey(z.string().min(1).parse(values.id));
    console.log('Key revoked.');
    return;
  }
  if (command !== 'create') throw new Error('Unknown command. Use --help.');

  const agentId = z.string().min(1).parse(values.agent);
  // --days=never issues a non-expiring (still revocable) key.
  const days =
    values.days === 'never'
      ? null
      : z.coerce.number().int().min(1).max(365).parse(values.days);
  const name = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .parse(values.name || 'CLI');
  const output = z.string().min(1).parse(values.output);
  const created = await createAgentKey({
    agentId,
    name,
    expiresAt: days === null ? null : new Date(Date.now() + days * 86400000),
  });
  try {
    await writeFile(output, created.token, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    await revokeAgentKey(created.id);
    throw error;
  }
  console.log(
    JSON.stringify(
      {
        id: created.id,
        agentId,
        name,
        expiresAt: created.expiresAt,
        keyFile: output,
      },
      null,
      2
    )
  );
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      error instanceof z.ZodError
        ? 'Invalid command arguments. Use --help.'
        : error.message
    );
    process.exit(1);
  });
