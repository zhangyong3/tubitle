import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Credentials for one or more ShipAny sites ("projects"), kept in a private
// local file. Tokens are never printed; `projects` shows only a prefix.
export function storePath(env = process.env) {
  return env.SHIPANY_ADMIN_CONFIG || join(homedir(), '.shipany', 'admin-projects.json');
}

function siteUrl(raw) {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) throw new Error('Use a plain HTTP(S) site URL without embedded credentials, query, or fragment.');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote administration requires HTTPS.');
  return url.origin;
}

function checkName(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name || '')) throw new Error('Project names use letters, digits, dots, underscores and hyphens.');
  return name;
}

export async function readStore(env = process.env) {
  try {
    const data = JSON.parse(await readFile(storePath(env), 'utf8'));
    return { projects: data.projects || {}, default: data.default };
  } catch (error) {
    if (error.code === 'ENOENT') return { projects: {}, default: undefined };
    throw new Error(`Cannot read ${storePath(env)}.`);
  }
}

async function writeStore(store, env = process.env) {
  const file = storePath(env);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
}

/**
 * Resolve which site to talk to: --project NAME, then SHIPANY_ADMIN_PROJECT,
 * then the SHIPANY_ADMIN_URL/TOKEN env pair, then the default or only project.
 * @param {{ project?: string, env?: Record<string, string | undefined> }} [options]
 */
export async function resolveConnection({ project, env = process.env } = {}) {
  const name = project || env.SHIPANY_ADMIN_PROJECT;
  if (!name && env.SHIPANY_ADMIN_URL && env.SHIPANY_ADMIN_TOKEN) return adminConnection(env);
  const store = await readStore(env);
  const names = Object.keys(store.projects);
  const chosen = name || store.default || (names.length === 1 ? names[0] : undefined);
  if (!chosen) {
    throw new Error(names.length
      ? `Several projects are configured (${names.join(', ')}). Pass --project NAME.`
      : 'No project configured. Add one with: node admin-client.mjs add NAME URL  (token on stdin)');
  }
  const entry = store.projects[chosen];
  if (!entry) throw new Error(`Unknown project "${chosen}". Configured: ${names.join(', ') || 'none'}.`);
  return { baseUrl: siteUrl(entry.url), token: entry.token, project: chosen };
}

export function adminConnection(env = process.env) {
  if (!env.SHIPANY_ADMIN_URL || !env.SHIPANY_ADMIN_TOKEN) throw new Error('Set SHIPANY_ADMIN_URL and SHIPANY_ADMIN_TOKEN, or add a project.');
  return { baseUrl: siteUrl(env.SHIPANY_ADMIN_URL), token: env.SHIPANY_ADMIN_TOKEN, project: undefined };
}

export async function adminRequest(path, body, connection) {
  connection ??= await resolveConnection();
  const response = await fetch(`${connection.baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error', signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json();
  return { status: response.status, result };
}

/** Save a project after proving the token works against that site. */
export async function addProject(name, url, token, env = process.env) {
  checkName(name);
  token = (token || '').trim();
  if (!/^sa_admin_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('The token must be an admin key starting with sa_admin_ (pass it on stdin).');
  const connection = { baseUrl: siteUrl(url), token };
  const check = await adminRequest('/api/admin/agent/operations', undefined, connection);
  if (check.status !== 200 || check.result.code !== 0) throw new Error('The site rejected this token; nothing was saved.');
  const store = await readStore(env);
  store.projects[name] = { url: connection.baseUrl, token };
  if (!store.default) store.default = name;
  await writeStore(store, env);
  return { project: name, url: connection.baseUrl, operations: check.result.data.length, default: store.default === name };
}

const USAGE = `Usage: node admin-client.mjs [--project NAME] <command>

  list | openapi                         Allowed operations / OpenAPI document
  call OPERATION INPUT.json [IDEM_KEY]   Execute (use - to read JSON from stdin)

  add NAME URL                           Save a project; the token is read from stdin
  projects                               List projects (tokens are never shown)
  use NAME                               Set the default project
  remove NAME                            Forget a project

Projects live in ${storePath()} (mode 0600; override with SHIPANY_ADMIN_CONFIG).
SHIPANY_ADMIN_URL + SHIPANY_ADMIN_TOKEN still work for a single site.`;

async function main() {
  const args = process.argv.slice(2);
  let project;
  const at = args.findIndex((a) => a === '--project' || a === '-p');
  if (at !== -1) [, project] = args.splice(at, 2);
  const [command, a1, a2, a3] = args;
  if (command === 'help' || !command) return console.log(USAGE);

  if (command === 'add') {
    const token = await readFile('/dev/stdin', 'utf8');
    return console.log(JSON.stringify(await addProject(a1, a2, token), null, 2));
  }
  if (command === 'projects') {
    const store = await readStore();
    return console.log(JSON.stringify(Object.entries(store.projects).map(([name, p]) => ({
      name, url: p.url, token: `${p.token.slice(0, 13)}…`, default: store.default === name,
    })), null, 2));
  }
  if (command === 'use' || command === 'remove') {
    const store = await readStore();
    if (!store.projects[checkName(a1)]) throw new Error(`Unknown project "${a1}".`);
    if (command === 'use') store.default = a1;
    else {
      delete store.projects[a1];
      if (store.default === a1) store.default = Object.keys(store.projects)[0];
    }
    await writeStore(store);
    return console.log(JSON.stringify({ ok: true, default: store.default ?? null }));
  }

  const connection = await resolveConnection({ project });
  let response;
  if (command === 'list' || command === 'openapi') response = await adminRequest(`/api/admin/agent/${command === 'list' ? 'operations' : 'openapi'}`, undefined, connection);
  else if (command === 'call' && a1 && a2) {
    const source = a2 === '-' ? await readFile('/dev/stdin', 'utf8') : await readFile(a2, 'utf8');
    response = await adminRequest('/api/admin/agent/execute', { operation: a1, input: JSON.parse(source), ...(a3 ? { idempotencyKey: a3 } : {}) }, connection);
  } else throw new Error('Invalid command. Run with help.');
  console.log(JSON.stringify(response.result, null, 2));
  if (response.status >= 400 || (response.result.code !== undefined && response.result.code !== 0)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Our own messages never contain a token; anything else gets a generic hint.
    const own = error instanceof Error && !/sa_admin_[A-Za-z0-9_-]{8}/.test(error.message);
    console.error(own ? error.message : 'Admin request failed. Check the command, connection, and credentials.');
    console.error('If a write timed out, reuse its original idempotency key; do not create a new one.');
    process.exitCode = 1;
  });
}
