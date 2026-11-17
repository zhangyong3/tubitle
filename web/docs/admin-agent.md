# Agent administration

The existing admin REST routes, remote MCP server, local MCP bridge, and bundled skill use one operation contract in `src/lib/admin-operations.ts`.

**Identity model.** Each agent is a service account: a `user` row with `type = 'api'`. It has no password or OAuth link (its email is on the reserved `.invalid` TLD), can't sign in, and is excluded from user lists and analytics. Its permissions are exactly the RBAC roles assigned to it — the same roles defined under Admin → Roles. Its credentials are `apikey` rows with `type = 'admin'` (`sa_admin_…`): hash-only (never stored recoverably, shown once), optionally expiring, and revocable. Admin keys never authenticate the product API, product `sk_` keys (`type = 'user'`) never authenticate admin routes, and an admin-type key on a human account is rejected.

## Setup

Development: run `pnpm db:push` after updating the working schema. Production: generate and review migrations before running `pnpm db:migrate`; do not use `db:push` on production. Existing installations can run `pnpm admin:token sync-permissions` to register missing granular permission definitions without changing role assignments.

**Admin panel (recommended):** `/admin/agent` → Agent accounts. A full administrator (`admin.*`, browser session) creates an agent, picks its roles, and issues keys (7/30/90/365 days or never). An operator can only grant roles whose permissions they hold themselves. Changing an agent's roles, disabling a role, revoking a key or deleting the agent applies to the next call; deleting an agent removes its role assignments and keys and keeps its execution history.

**CLI (bootstrap, needs database owner environment):**

```sh
pnpm admin:token roles
pnpm admin:token create-agent --name="Claude Code" --roles=viewer
pnpm admin:token create --agent=AGENT_ID --name=laptop --days=30 --output=/secure/path/admin-key
pnpm admin:token agents
pnpm admin:token revoke --id=KEY_ID
```

The output file must not exist; it is created with mode 0600 and the key is never printed. Put the key in your agent's secret store/environment as `SHIPANY_ADMIN_TOKEN`; use `SHIPANY_ADMIN_URL=https://your-site.example` for the site. These are client-side process variables, not `VITE_` variables or application provider settings. Do not put credentials in the repository. Expiry is 1–365 days, or `--days=never` (still revocable; give such agents minimal roles).

The panel uses `/api/admin/agent/accounts` (GET list, POST `{ name, roleIds }`, PATCH `{ id, name?, roleIds? }`, DELETE `?id=`) and `/api/admin/agent/keys` (POST `{ agentId, name, expiresAt }` with an ISO timestamp within 365 days or `null`; DELETE `?id=`). Both require a same-origin `admin.*` browser session — an agent key can never mint or manage keys.

## API

Send `Authorization: Bearer <agent admin key>` to:

| Endpoint                                        | Purpose                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/admin/agent/operations`               | Allowed operations with descriptions and JSON input/output schemas                                                             |
| `GET /api/admin/agent/openapi`                  | Raw OpenAPI 3.1 document for allowed REST operations                                                                           |
| `POST /api/admin/agent/execute`                 | Invoke `{ operation, input, idempotencyKey? }`                                                                                 |
| Existing `/api/admin/*` endpoints               | Same operations through their original REST URLs                                                                               |
| `GET /api/admin/agent/audit?page=1&pageSize=20` | Execution history without replay payloads: an admin session sees every agent (`&userId=` to filter); a key sees only its agent |

Read example:

```json
{
  "operation": "users_list",
  "input": { "search": "customer@example.com", "pageSize": 20 }
}
```

Write example after resolving the exact user:

```json
{
  "operation": "credits_adjust",
  "input": {
    "userId": "resolved-user-id",
    "action": "grant",
    "credits": 100,
    "description": "Requested adjustment"
  },
  "idempotencyKey": "credit-request-unique-id"
}
```

Direct REST writes use the `Idempotency-Key` header instead. Agent-key writes require it; existing browser writes may omit it. API responses retain `{ code, message, data? }`; failures also use HTTP 400/401/403/409/500 as appropriate. Responses include `X-Request-Id`. The capability contract restricts pagination to 100 per page and validates write parameters before execution.

Coverage follows the current backend: users and balances/details, and each user's activity timeline (`users_timeline`); order listing, local updates and registered provider refund operations; subscription listing; credit history and adjustments; database post/category CRUD; invite codes; role/permission management; tickets and replies; settings, custom settings, and provider tests; registered analytics operations. Source-bundled MDX editing and arbitrary SQL are not admin API operations. `orders_update` only edits local metadata; the separately permissioned `orders_refund` operation (`admin.payments.refund`), when registered, refunds real money and may cancel the subscription as part of that refund. Credential administration is a separate control plane.

## Scheduled reports

`analytics_report` (`GET /api/admin/analytics/report`, needs `admin.payments.read`) returns one period's business metrics plus the preceding equal-length period for deltas: new users, checkout users/orders, paid orders (new purchases vs renewals), paying and first-time payers, revenue/refunds/net per currency (minor units), `checkoutToPaid` and `signupToPaid` rates (0–1, `null` without a base), and subscriptions started/canceled, plus `subscriptionsActiveNow`. Agent service accounts are never counted as users. Retention isn't included yet — it needs per-day activity tracking the schema doesn't record.

Pass `from`/`to` as ISO timestamps **with the reporting timezone's offset** — that's what makes "a day" match your business day. Defaults to the last 24 hours; max span 92 days; `compare=false` skips the previous period. A daily pull for yesterday in UTC+8:

```sh
curl -s "https://your-site.example/api/admin/analytics/report?from=2026-10-10T00:00:00%2B08:00&to=2026-10-11T00:00:00%2B08:00" \
  -H "Authorization: Bearer $SHIPANY_ADMIN_TOKEN"
```

Over MCP, call the `analytics_report` tool with `{ "input": { "from": "...", "to": "..." } }`. Give the reporting agent a read-only role.

## MCP

Remote Streamable HTTP endpoint:

```text
https://your-site.example/api/admin/agent/mcp
```

Configure the MCP client to attach the agent's admin key as a bearer token. This endpoint uses pre-issued machine credentials; it does **not** implement OAuth discovery or browser consent. Clients that require OAuth-only remote connections should use the local stdio bridge. HTTP MCP is stateless, supports current and legacy stateless SDK exchanges, and rejects cookies as credentials and foreign browser origins. Tool discovery is filtered by the agent's roles.

For stdio, launch from this checkout:

```json
{
  "mcpServers": {
    "shipany-admin": {
      "command": "pnpm",
      "args": [
        "--dir",
        "/absolute/path/to/shipany-tanstack",
        "--silent",
        "admin:mcp"
      ]
    }
  }
}
```

Supply `SHIPANY_ADMIN_URL` and `SHIPANY_ADMIN_TOKEN` through your client's environment/secret mechanism. The bridge fetches tool definitions from the configured site and reauthenticates through the API for every call; restarting refreshes the advertised tool list after the agent's roles change. No logs or env-loader banners are written to its MCP stdout.

Each tool accepts:

```json
{
  "input": { "userId": "resolved-user-id", "action": "grant", "credits": 100 },
  "idempotencyKey": "credit-request-unique-id"
}
```

Read tools require only `input` (use `{}` when no filters are needed). Failures set MCP `isError`; the API envelope is returned as structured content.

## Skill and standalone CLI

The repository skill is `.claude/skills/shipany-admin/SKILL.md`, available through the existing cross-agent skill symlinks. Copy the entire `shipany-admin` folder into another agent's skill library to use it independently. A deployed site also serves both files publicly (no secrets in them) at `/api/admin/agent/skill?file=SKILL.md` and `/api/admin/agent/skill?file=admin-client.mjs` (query, not path: the Vite dev server would treat a path ending in `.md`/`.mjs` as a static file); the Skill tab on `/admin/agent` gives a ready-to-paste prompt that has the agent download them and read its key from `SHIPANY_ADMIN_TOKEN`. Files under `.claude/` are excluded from MDX compilation (`vite.config.ts`) so they're served verbatim. Its `scripts/admin-client.mjs` needs Node 20+ and no dependencies:

```sh
node .claude/skills/shipany-admin/scripts/admin-client.mjs list
node .claude/skills/shipany-admin/scripts/admin-client.mjs openapi
node .claude/skills/shipany-admin/scripts/admin-client.mjs call users_list /tmp/input.json
```

**Several sites.** The client keeps named projects (URL + admin key) in `~/.shipany/admin-projects.json` (mode 0600; `SHIPANY_ADMIN_CONFIG` overrides the path). Keys are read from stdin and verified against the site before saving, and are never printed (`projects` masks them):

```sh
printf '%s' "$KEY" | node .claude/skills/shipany-admin/scripts/admin-client.mjs add myshop https://myshop.example
node .claude/skills/shipany-admin/scripts/admin-client.mjs projects
node .claude/skills/shipany-admin/scripts/admin-client.mjs --project myshop call analytics_report /tmp/input.json
node .claude/skills/shipany-admin/scripts/admin-client.mjs use myshop      # default project
node .claude/skills/shipany-admin/scripts/admin-client.mjs remove myshop
```

Resolution order: `--project`, `SHIPANY_ADMIN_PROJECT`, the `SHIPANY_ADMIN_URL`/`SHIPANY_ADMIN_TOKEN` pair, then the default (or only) project. The Skill prompt on each site's `/admin/agent` page names the project after the site, so pasting it on several sites builds up the list; MCP snippets likewise use a per-site server name.

Use JSON files or stdin (`-`) for inputs; do not put secrets in command arguments. The client refuses credential-bearing redirects and non-HTTPS remote URLs (localhost HTTP is allowed).

## Execution journal and retry semantics

Authenticated, authorized, validated operations reserve a durable execution record before running. Records include actor, credential ID, operation, target ID, timestamps, and outcome. Raw request bodies, credentials and configuration secrets are not logged. A keyed request hash detects changed input. Read results are not retained; write response envelopes are retained for replay and may contain business data such as created invitation codes. Restrict database access accordingly. The audit API excludes response envelopes and request hashes.

A token/operation/idempotency-key tuple executes at most once while its journal record is retained. Concurrent retries either replay the completed result or receive 409. Business errors are replayed too; after correcting input use a new key. A crash or journal failure after side effects leaves a pending/unknown record and blocks blind replay. This is conservative duplicate prevention, not a distributed transaction with external providers. Do not delete pending/unknown records to force retries. Do not purge journal rows while their idempotency keys might be retried; purging removes duplicate protection. Rotating `AUTH_SECRET` can invalidate request-hash comparisons for prior keys.

Session mutations additionally require a matching Origin. New deployments should use HTTPS. Perimeter rate limits and database retention are deployment policies; this feature does not install either automatically.

## Development and validation

Add a schema/permission/description/path in `src/lib/admin-operations.ts`, implement the server handler under `src/server/admin/handlers/`, register it in `handlers.ts`, and mount a thin REST wrapper with `runAdminRoute`. OpenAPI, MCP and operation discovery then update together. Modules remain independent; cross-module orchestration lives in the server layer.

```sh
pnpm test:admin
pnpm exec tsc --noEmit
pnpm build
```

The integration suite creates and removes a temporary SQLite database. It checks that agent permissions follow their roles, role-escalation limits, expiry/revocation, admin/product key isolation, agent deletion, input validation, concurrency/idempotency, secret masking, post operations, real HTTP and stdio MCP clients, and credential file permissions. Run it with a SQLite working schema. Provider message tests do not run and real business records are not changed.
