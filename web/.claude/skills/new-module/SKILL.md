---
name: new-module
description: "Create a new business module with service layer and API routes following the ShipAny module pattern. Use when the user needs new backend functionality — a new service, a new data model, a new API. Triggers on: 'add a module for...', 'I need backend for...', 'create a service for...'"
argument-hint: "<module name and what it does>"
user-invocable: true
---

# New Module — $ARGUMENTS

Create a new module following the ShipAny module pattern.

## Step 1: Analyze Requirements

From "$ARGUMENTS", determine:
- **Module name** (lowercase, e.g., `projects`, `notifications`, `webhooks`)
- **What data it manages** — check if the existing 19 tables in `schema.ts` cover it, or if new tables are needed
- **CRUD operations** needed (create, list, get, update, delete)
- **Business logic** beyond CRUD (validation, side effects, cross-service calls)

## Step 2: Check Schema

The existing schema has 19 tables. Check if any can be reused:
- `post` + `taxonomy` — generic content system (can store any content type via `type` field)
- `config` — key-value settings
- `credit` — any point/balance system
- `order` — any purchase/transaction tracking
- `aiTask` — any async job tracking

If a new table is needed, add it to `src/config/db/schema.ts` under the "Custom tables" section, using the same dialect already in the file. Then run `pnpm db:push`.

## Step 3: Create Service

Create `src/modules/<name>/service.ts`:

```typescript
import { eq, and, desc, isNull } from 'drizzle-orm';
import { getUuid } from '@/lib/hash';
import { db } from '@/core/db';
import { tableName } from '@/config/db/schema';

/**
 * Create a new <entity>.
 */
export async function create(params: {
  userId: string;
  // ... entity-specific fields
}) {
  const [result] = await db()
    .insert(tableName)
    .values({
      id: getUuid(),
      ...params,
    })
    .returning();
  return result;
}

/**
 * List <entities> for a user.
 */
export async function list(userId: string) {
  return db()
    .select()
    .from(tableName)
    .where(and(eq(tableName.userId, userId), isNull(tableName.deletedAt)))
    .orderBy(desc(tableName.createdAt));
}

/**
 * Get a single <entity> by ID.
 */
export async function getById(id: string) {
  const [result] = await db()
    .select()
    .from(tableName)
    .where(eq(tableName.id, id))
    .limit(1);
  return result;
}

/**
 * Update an <entity>.
 */
export async function update(id: string, data: Partial<NewTableName>) {
  const [result] = await db()
    .update(tableName)
    .set(data)
    .where(eq(tableName.id, id))
    .returning();
  return result;
}

/**
 * Soft-delete an <entity>.
 */
export async function remove(params: { userId: string; id: string }) {
  await db()
    .update(tableName)
    .set({ deletedAt: new Date() })
    .where(and(eq(tableName.id, params.id), eq(tableName.userId, params.userId)));
}
```

### Module Rules

1. **Only import from:** `@/core/`, `@/config/`, `@/lib/`, `drizzle-orm`
2. **Never import from** other modules — unless this module genuinely needs to trigger another module's logic (document why)
3. **Export pure functions** — no React, no route handlers, no middleware
4. **Use `getUuid()`** for IDs, `getSnowId()`/`getUniSeq()` for order-like sequential IDs
5. **Soft delete** via `deletedAt` field — don't hard-delete user data
6. **Atomic writes** for multi-statement or multi-table operations: `atomic((q) => [guard(...), q.update(...), q.insert(...)])` from `@/core/db/atomic`. Never use `db().transaction()`, because on D1 it runs statements one by one with no rollback. Read first, build all writes up front, and express conditions as `guard`s (see AGENTS.md → "Atomic writes").
7. **Money, credits, permissions, secrets**: follow AGENTS.md → "Security & Integrity Rules for New Features"
8. **D1 limit**: at most 100 bound parameters per statement. Chunk big `inArray` lists and bulk inserts.
9. **Admin timeline visibility**: decide what an admin investigating a user should see from this feature (see "Product events" below). Don't import `@/modules/events/service` from your service, because modules don't import each other. Record events in the API route.

## Step 4: Create API Server Route

Create `src/routes/api/<name>.ts`. Handlers are named functions registered under `server.handlers`, each receiving `{ request }` (a standard `Request`):

```typescript
import { createFileRoute } from '@tanstack/react-router';
import { respData, respOk, respErr } from '@/lib/resp';
import { getAuth } from '@/core/auth';
import * as service from '@/modules/<name>/service';

async function GET({ request }: { request: Request }) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return respErr('Unauthorized');

  const data = await service.list(session.user.id);
  return respData(data);
}

async function POST({ request }: { request: Request }) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return respErr('Unauthorized');

  const body = await request.json();
  // validate body...
  const result = await service.create({ userId: session.user.id, ...body });
  return respData(result);
}

async function DELETE({ request }: { request: Request }) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return respErr('Unauthorized');

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return respErr('ID is required');

  await service.remove({ userId: session.user.id, id });
  return respOk();
}

export const Route = createFileRoute('/api/<name>')({
  server: { handlers: { GET, POST, DELETE } },
});
```

For dynamic params, use `$param.ts` (read via `params.param` in the handler context); for catch-all, use `$.ts`.

## Step 5: Verify

1. Run `pnpm build` — must pass
2. Test with `pnpm dev` — verify the API responds correctly

## Step 6: Report

Tell the user:
- Module location: `src/modules/<name>/service.ts`
- API server route: `src/routes/api/<name>.ts` → `/api/<name>` (methods available)
- Schema: which table(s) used or if new table needed
- Timeline: which events now show in the admin user timeline (or why none)
- Next steps: "Run `/new-page <description>` to add a dashboard view with i18n"

## Integration Patterns

If the module needs to interact with existing modules:

**Need credits?** Call `consume`/`grant` from `@/modules/credits/service`
**Need payment?** Don't — let the payment module call your module. Add a hook in `payment/service.ts` handleCheckoutSuccess.
**Need auth check?** Done at the API route level, not in the service.
**Need permission check?** Call `hasPermission` from `@/modules/rbac/service` in the API route.

### Product events (admin user timeline)

The admin user detail page shows a timeline per user. Orders,
subscriptions, credits, AI tasks and tickets appear automatically. Make your
feature's important moments show up too:

- **The feature has its own table** (e.g. a gift log): don't record anything
  twice. Add a source to `src/server/admin/timeline-sources.ts`. Its comment
  has the full example, and `from` / `by` / `limit` must be applied as shown.
- **Nothing stores the moment** (user hit a limit, was blocked, picked an
  option):
  1. Register the kind in `src/config/events.ts` with a `tone`. Add
     `client: true` **only** if the browser may report it. Never add it for
     risk, money or permission events, because anyone can call the endpoint.
  2. Server side, record it in the API route after the decision:
     ```ts
     import { recordEvent } from '@/modules/events/service';
     await recordEvent({ userId: session.user.id, kind: 'risk_flagged', detail: { reason } });
     ```
     It never throws, so it can't break the request.
  3. Browser side (client kinds only), in a component:
     ```ts
     import { track } from '@/lib/track';
     track('paywall_hit', { feature: 'hd_export' });
     ```
  4. `detail` is flat: up to 10 keys, strings ≤ 200 chars, numbers or
     booleans. No secrets, emails or other personal data.
- **Label** every new kind: `admin.user_detail.timeline_<kind>` in both
  `messages/en.json` and `messages/zh.json`.
- Agents read the same data with the `users_timeline` admin operation.
- Adding the first event to an existing project needs the `user_event` table
  (UPGRADING.md, 2026-10-12).
