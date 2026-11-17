import { z } from 'zod';

// The shared contract for REST, MCP, documentation, and permission discovery.
const id = z.string().min(1).max(191);
const short = z.string().max(500);
const text = z.string().max(100_000);
const page = {
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
};
const search = { ...page, search: short.optional() };
const postStatus = z.enum(['draft', 'pending', 'published', 'archived']);
const ticketStatus = z.enum(['open', 'replied', 'closed']);
// No 'draft': unpaid drafts never show up in admin lists.
const guestPostStatus = z.enum([
  'submitted',
  'changes_requested',
  'published',
  'rejected',
  'unpublished',
]);
const postFields = {
  slug: z.string().min(1).max(191),
  title: z.string().min(1).max(500),
  description: text.optional(),
  image: short.optional(),
  content: z.string().max(1_000_000).optional(),
  categories: short.optional(),
  authorName: short.optional(),
  status: postStatus.optional(),
};
const categoryFields = { slug: id, title: id, description: text.optional() };
const roleFields = { name: id, title: id, description: text.optional() };
const permissionFields = { code: id, resource: id, action: id, title: id };
const strings = z.record(z.string().min(1).max(191), text);
const empty = z.object({}).strict();
const funnelDimensions = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'referrer',
  'country',
] as const;
const funnelDimension = z.enum(funnelDimensions);
const remove = z.object({ id }).strict();

export interface AdminOperation {
  name: string;
  description: string;
  permission: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  schema: z.ZodType;
  readOnly: boolean;
}
function op(
  name: string,
  description: string,
  permission: string,
  method: AdminOperation['method'],
  path: string,
  schema: z.ZodType
): AdminOperation {
  return {
    name,
    description,
    permission: `admin.${permission}`,
    method,
    path: `/api/admin/${path}`,
    schema,
    readOnly: method === 'GET',
  };
}

export const adminOperations: AdminOperation[] = [
  op(
    'users_list',
    "List users with balances. Search matches email or name; verify an exact email before a write. utm_source filters by exact sign-up source; '' selects untagged (direct) users.",
    'users.read',
    'GET',
    'users',
    z.object({ ...search, utm_source: z.string().max(500).optional() }).strict()
  ),
  op(
    'users_sources',
    'List the most common sign-up utm_source values across all users, with user counts — the valid utm_source filter values for users_list.',
    'users.read',
    'GET',
    'users/sources',
    empty
  ),
  op(
    'users_get',
    'Read one user: profile, sign-up attribution (UTM, referrer, IP, country), roles, and order/credit totals. Use orders_list/credits_list with userId for the records.',
    'users.read',
    'GET',
    'users/{id}',
    remove
  ),
  op(
    'users_timeline',
    "A user's activity timeline: sign-up (with source), orders created/paid/failed/refunded, subscriptions started/canceled, credit grants and charges, AI tasks created/succeeded/failed, tickets opened. order=asc gives oldest first (the user's journey); default desc is newest first. Page by passing nextCursor back as cursor with the same order.",
    'users.read',
    'GET',
    'users/timeline',
    z
      .object({
        userId: id,
        order: z.enum(['asc', 'desc']).optional(),
        cursor: z.string().max(300).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .strict()
  ),
  op(
    'users_set_password',
    "Set a user's sign-in password (adds an email/password login if the user only used OAuth) and sign them out everywhere. Admin console only: rejected for API keys. Cannot target a user whose roles exceed the caller's permissions.",
    'passwords.reset',
    'POST',
    'users/password',
    z.object({ userId: id, password: z.string().min(8).max(128) }).strict()
  ),
  op(
    'credits_adjust',
    'Grant or deduct a positive number of credits for a user. Requires a stable idempotency key.',
    'credits.write',
    'POST',
    'users/credits',
    z
      .object({
        userId: id,
        action: z.enum(['grant', 'deduct']),
        credits: z.number().int().positive().max(1_000_000_000),
        description: short.optional(),
      })
      .strict()
  ),
  op(
    'orders_list',
    'List orders and payment metadata.',
    'payments.read',
    'GET',
    'orders',
    z
      .object({
        ...search,
        userId: id.optional(),
        status: short.optional(),
        paymentType: short.optional(),
      })
      .strict()
  ),
  op(
    'orders_update',
    'Edit local order metadata/status only. Does not charge, refund, grant credits, or synchronize a payment provider.',
    'payments.write',
    'PATCH',
    'orders',
    z
      .object({
        orderNo: id,
        status: z
          .enum(['pending', 'created', 'paid', 'failed', 'refunded', 'deleted'])
          .optional(),
        productId: short.optional(),
        productName: short.optional(),
        description: text.optional(),
      })
      .strict()
  ),
  op(
    'orders_refund',
    "Refund a paid order IN FULL through its payment provider (real money), deduct the credits it granted (default: the order's credits; never below zero), and optionally cancel its subscription immediately. Irreversible.",
    'payments.refund',
    'POST',
    'orders/refund',
    z
      .object({
        orderNo: id,
        reason: short.optional(),
        deductCredits: z.number().int().min(0).max(1_000_000_000).optional(),
        cancelSubscription: z.boolean().optional(),
      })
      .strict()
  ),
  op(
    'analytics_report',
    'Business report for a period, built for scheduled pulls: new users, checkouts, paid orders (new vs renewal), paying and first-time payers, revenue/refunds/net per currency (minor units), checkout→paid and signup→paid rates (0–1, null when no base), subscriptions started/canceled, plus the same metrics for the preceding equal-length period. from/to are ISO timestamps with offset (use the reporting timezone, e.g. from=2026-10-10T00:00:00+08:00&to=2026-10-11T00:00:00+08:00 for one day); default is the last 24 hours; max span 92 days. Agent service accounts are not counted as users.',
    'payments.read',
    'GET',
    'analytics/report',
    z
      .object({
        from: z.iso.datetime({ offset: true }).optional(),
        to: z.iso.datetime({ offset: true }).optional(),
        compare: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
      })
      .strict()
  ),
  op(
    'analytics_overview',
    'Admin overview KPIs: total and 24h-new users, last-30-day net revenue per currency (renewals included, refunds subtracted, minor units), live subscriptions, open tickets.',
    'payments.read',
    'GET',
    'analytics/overview',
    empty
  ),
  op(
    'analytics_funnel',
    'Signup → checkout → paid conversion (distinct users, renewals excluded) for users who signed up in the window. Filter by first-touch utm_*/referrer/country (empty string = untagged); groupBy picks the breakdown dimension.',
    'payments.read',
    'GET',
    'analytics/funnel',
    z
      .object({
        range: z.enum(['24h', '7d', '30d']).optional(),
        groupBy: funnelDimension.optional(),
        ...Object.fromEntries(
          funnelDimensions.map((d) => [d, z.string().max(500).optional()])
        ),
      })
      .strict()
  ),
  op(
    'subscriptions_list',
    'List subscriptions; this operation does not cancel or modify provider subscriptions.',
    'subscriptions.read',
    'GET',
    'subscriptions',
    z
      .object({ ...page, status: short.optional(), interval: short.optional() })
      .strict()
  ),
  op(
    'credits_list',
    'List credit transactions. The default status filter is active; status=all includes expired and deleted records.',
    'credits.read',
    'GET',
    'credits',
    z
      .object({
        ...search,
        userId: id.optional(),
        status: short.optional(),
        transactionType: z.enum(['grant', 'consume']).optional(),
      })
      .strict()
  ),
  op(
    'categories_list',
    'List categories; all=true returns the complete category dropdown list.',
    'categories.read',
    'GET',
    'categories',
    z
      .object({
        ...search,
        all: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
      })
      .strict()
  ),
  op(
    'categories_create',
    'Create a category.',
    'categories.write',
    'POST',
    'categories',
    z.object(categoryFields).strict()
  ),
  op(
    'categories_update',
    'Update category fields.',
    'categories.write',
    'PUT',
    'categories',
    z
      .object(categoryFields)
      .partial()
      .extend({
        id,
        status: z.enum(['published', 'draft', 'archived']).optional(),
      })
      .strict()
  ),
  op(
    'categories_delete',
    'Soft-delete a category.',
    'categories.delete',
    'DELETE',
    'categories',
    remove
  ),
  op(
    'posts_list',
    'List database posts, or supply id to retrieve one post with its content. Bundled MDX posts are maintained in source files.',
    'posts.read',
    'GET',
    'posts',
    z
      .object({ ...search, id: id.optional(), status: postStatus.optional() })
      .strict()
  ),
  op(
    'posts_create',
    'Create a database post. Use status=draft unless publishing is requested.',
    'posts.write',
    'POST',
    'posts',
    z.object(postFields).strict()
  ),
  op(
    'posts_update',
    'Update a database post; status=published publishes it.',
    'posts.write',
    'PUT',
    'posts',
    z.object(postFields).partial().extend({ id }).strict()
  ),
  op(
    'posts_delete',
    'Archive a database post.',
    'posts.delete',
    'DELETE',
    'posts',
    remove
  ),
  op(
    'invite_codes_list',
    'List invite codes and their usage.',
    'invite_codes.read',
    'GET',
    'invite-codes',
    z
      .object({ ...search, status: z.enum(['available', 'used']).optional() })
      .strict()
  ),
  op(
    'invite_codes_create',
    'Create one invite code or a batch of up to 100 codes.',
    'invite_codes.write',
    'POST',
    'invite-codes',
    z
      .object({
        code: id.optional(),
        count: z.number().int().min(1).max(100).optional(),
        maxUses: z.number().int().positive().max(1_000_000).optional(),
        trialDays: z.number().int().min(0).max(3650).optional(),
        note: short.optional(),
        expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
      })
      .strict()
  ),
  op(
    'invite_codes_delete',
    'Delete an invite code.',
    'invite_codes.delete',
    'DELETE',
    'invite-codes',
    remove
  ),
  op(
    'permissions_list',
    'List permission definitions.',
    'permissions.read',
    'GET',
    'permissions',
    z.object(search).strict()
  ),
  op(
    'permissions_create',
    'Create a permission definition.',
    'permissions.write',
    'POST',
    'permissions',
    z.object(permissionFields).strict()
  ),
  op(
    'permissions_update',
    'Update a permission definition. Changes affect roles using it.',
    'permissions.write',
    'PUT',
    'permissions',
    z
      .object(permissionFields)
      .partial()
      .extend({ id, description: text.optional() })
      .strict()
  ),
  op(
    'permissions_delete',
    'Delete a permission definition.',
    'permissions.delete',
    'DELETE',
    'permissions',
    remove
  ),
  op(
    'roles_list',
    'List active roles, or supply userId to inspect assigned roles.',
    'roles.read',
    'GET',
    'roles',
    z.object({ ...search, userId: id.optional() }).strict()
  ),
  op(
    'roles_create',
    'Create a role.',
    'roles.write',
    'POST',
    'roles',
    z.object(roleFields).strict()
  ),
  op(
    'roles_update',
    'Update role metadata.',
    'roles.write',
    'PUT',
    'roles',
    z.object(roleFields).partial().extend({ id }).strict()
  ),
  op(
    'roles_delete',
    'Disable a role and its effective permissions.',
    'roles.delete',
    'DELETE',
    'roles',
    remove
  ),
  op(
    'roles_assign',
    'Assign a role to a user; this can increase their privileges.',
    'roles.write',
    'POST',
    'roles/assign',
    z.object({ userId: id, roleId: id }).strict()
  ),
  op(
    'roles_unassign',
    'Remove a role from a user.',
    'roles.write',
    'DELETE',
    'roles/assign',
    z.object({ userId: id, roleId: id }).strict()
  ),
  op(
    'roles_permissions_get',
    'Read the permission IDs assigned to a role.',
    'roles.read',
    'GET',
    'roles/permissions',
    z.object({ roleId: id }).strict()
  ),
  op(
    'roles_permissions_update',
    'Replace ALL permissions of a role. An empty list removes every permission.',
    'roles.write',
    'PUT',
    'roles/permissions',
    z.object({ roleId: id, permissionIds: z.array(id).max(1000) }).strict()
  ),
  op(
    'tickets_list',
    'List support tickets with optional keyword/status filters.',
    'tickets.read',
    'GET',
    'tickets',
    z
      .object({
        ...page,
        keyword: short.optional(),
        status: ticketStatus.optional(),
      })
      .strict()
  ),
  op(
    'tickets_get',
    'Read a ticket, its user, and message history.',
    'tickets.read',
    'GET',
    'tickets/{id}',
    remove
  ),
  op(
    'tickets_reply',
    'Send an administrator reply to a user and mark the ticket replied.',
    'tickets.write',
    'POST',
    'tickets/{id}',
    z
      .object({
        id,
        content: z.string().trim().min(1).max(5000),
        attachments: z.array(z.string().max(2048)).max(9).optional(),
      })
      .strict()
  ),
  op(
    'tickets_update',
    'Close, reopen, or mark a ticket replied.',
    'tickets.write',
    'PATCH',
    'tickets/{id}',
    z.object({ id, status: ticketStatus }).strict()
  ),
  op(
    'guest_posts_list',
    'List guest post submissions (articles outside authors paid to publish) with optional status/keyword filters. status=submitted is the review queue (paid, awaiting a decision).',
    'guest-posts.read',
    'GET',
    'guest-posts',
    z.object({ ...search, status: guestPostStatus.optional() }).strict()
  ),
  op(
    'guest_posts_get',
    'Read a guest post submission with its article, package and author.',
    'guest-posts.read',
    'GET',
    'guest-posts/{id}',
    remove
  ),
  op(
    'guest_posts_review',
    'Review a paid guest post awaiting a decision: approve (publishes it now) or request_changes (the author edits and resubmits without paying again; note required). To reject, use guest_posts_reject.',
    'guest-posts.review',
    'POST',
    'guest-posts/{id}',
    z
      .object({
        id,
        action: z.enum(['approve', 'request_changes']),
        note: z.string().max(2000).optional(),
      })
      .strict()
  ),
  op(
    'guest_posts_reject',
    'Reject a paid guest post and refund its order in full (real money). Note to the author required.',
    'guest-posts.reject',
    'POST',
    'guest-posts/{id}/reject',
    z.object({ id, note: z.string().trim().min(1).max(2000) }).strict()
  ),
  op(
    'guest_posts_update',
    "Edit a guest post's article (title, URL slug, summary, cover, markdown). Edits a published one live; changing a published slug breaks its old URL. The package's link cap still applies.",
    'guest-posts.review',
    'PUT',
    'guest-posts/{id}',
    z
      .object({
        id,
        title: z.string().min(1).max(200),
        slug: z.string().max(80).optional(),
        description: z.string().max(500).optional(),
        image: z.string().max(2048).optional(),
        content: z.string().max(50_000),
      })
      .strict()
  ),
  op(
    'guest_posts_unpublish',
    'Take a published guest post down. It stays paid; refund the order separately if owed.',
    'guest-posts.review',
    'PATCH',
    'guest-posts/{id}',
    z.object({ id, note: z.string().max(2000).optional() }).strict()
  ),
  op(
    'guest_posts_restore',
    'Bring back an unpublished guest post whose order is still paid: republish (live again) or request_changes (the author edits and resubmits without paying; note required). Refunded ones cannot be restored.',
    'guest-posts.review',
    'POST',
    'guest-posts/{id}/restore',
    z
      .object({
        id,
        action: z.enum(['republish', 'request_changes']),
        note: z.string().max(2000).optional(),
      })
      .strict()
  ),
  op(
    'settings_get',
    'Read system settings. Secrets are masked and protected keys are excluded.',
    'settings.read',
    'GET',
    'config',
    empty
  ),
  op(
    'settings_update',
    'Update named system settings. Omitted keys are unchanged; masked secret placeholders are preserved.',
    'settings.write',
    'POST',
    'config',
    strings
  ),
  op(
    'custom_settings_get',
    'Read custom settings with secret-like values masked.',
    'settings.read',
    'GET',
    'config/custom',
    empty
  ),
  op(
    'custom_settings_replace',
    'Replace ALL custom settings. Omitted custom keys are deleted; read the current set first.',
    'settings.write',
    'POST',
    'config/custom',
    z
      .object({
        configs: z
          .array(z.object({ key: z.string().max(191), value: text }).strict())
          .max(500),
      })
      .strict()
  ),
  op(
    'settings_test',
    'Test a provider configuration; may send a real email or bot notification. Only call when that test is requested.',
    'settings.write',
    'POST',
    'settings/test',
    z
      .object({
        group: id,
        inputs: strings.optional(),
        configs: strings.optional(),
      })
      .strict()
  ),
];

export const adminScopes = [
  ...new Set(adminOperations.map((operation) => operation.permission)),
].sort();
export const envelopeSchema = {
  type: 'object',
  properties: {
    code: { type: 'integer' },
    message: { type: 'string' },
    data: {},
  },
  required: ['code', 'message'],
} as const;
export function operationDescriptor(operation: AdminOperation) {
  const { schema, ...metadata } = operation;
  return {
    ...metadata,
    inputSchema: z.toJSONSchema(schema, { io: 'input' }),
    outputSchema: envelopeSchema,
    requiresIdempotencyKey: !operation.readOnly,
  };
}
