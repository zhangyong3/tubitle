import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { eq } from 'drizzle-orm';

// Isolated SQLite database; no application modules load before the env is set.
const directory = await mkdtemp(join(tmpdir(), 'shipany-guest-post-test-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  AUTH_SECRET: 'isolated-guest-post-test-secret-not-a-real-credential',
  NODE_ENV: 'test',
  VITE_APP_URL: 'http://localhost:3000',
});
execFileSync(
  process.execPath,
  [
    'node_modules/drizzle-kit/bin.cjs',
    'push',
    '--dialect=sqlite',
    '--schema=./src/config/db/schema.sqlite.ts',
    `--url=${process.env.DATABASE_URL}`,
    '--force',
  ],
  { stdio: 'pipe', env: process.env }
);
const { db } = await import('../src/core/db');
const { order, post, user } = await import('../src/config/db/schema');
const gp = await import('../src/modules/guest-posts/service');
const { settleCheckoutOrder, refundOrder } =
  await import('../src/modules/payment/service');
const posts = await import('../src/modules/posts/service');

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

const author = 'author-1';
await db()
  .insert(user)
  .values({ id: author, name: 'Author', email: 'author@example.test' });

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
const article = (links = 1, title = 'How we scaled') => ({
  title,
  description: 'A case study',
  content: `${words(40)}\n\n${Array.from({ length: links }, (_, i) => `[site ${i}](https://example.com/${i})`).join(' ')}`,
});

function draft(productId = 'guest_post_standard', links = 1) {
  return gp.createGuestPost({
    userId: author,
    authorName: 'Author',
    productId,
    input: article(links),
  });
}

let seq = 0;
async function checkoutOrder(guestPostId: string) {
  const orderNo = `ORD-GP-${++seq}`;
  await db()
    .insert(order)
    .values({
      id: orderNo,
      orderNo,
      userId: author,
      userEmail: 'author@example.test',
      status: 'created',
      amount: 0, // refundOrder skips the provider call for 0
      currency: 'usd',
      productId: 'guest_post_standard',
      paymentType: 'one-time',
      paymentProvider: 'stripe',
      paymentSessionId: `cs_${orderNo}`,
      checkoutInfo: '{}',
      creditsAmount: 0,
      reference: gp.guestPostOrderReference(guestPostId),
    });
  const [row] = await db()
    .select()
    .from(order)
    .where(eq(order.orderNo, orderNo));
  return row;
}

const paid = (orderNo: string) => ({
  paymentStatus: 'paid',
  paymentResult: { id: orderNo },
  paymentInfo: { transactionId: `pi_${orderNo}`, paidAt: new Date() },
});

async function read(id: string) {
  const row = await gp.getGuestPost(id);
  assert.ok(row);
  return row;
}

async function orderStatus(orderNo: string) {
  const [o] = await db().select().from(order).where(eq(order.orderNo, orderNo));
  return o.status;
}

/** A draft paid for through the real settlement path. */
async function paidSubmission() {
  const id = await draft();
  const o = await checkoutOrder(id);
  await settleCheckoutOrder(o, paid(o.orderNo), 'stripe');
  return { id, orderNo: o.orderNo };
}

test('checkout checks the saved article: word minimum and package link cap', async () => {
  const id = await draft('guest_post_standard', 2);
  await assert.rejects(
    gp.getPayableGuestPost(id, author, { minWords: 10 }),
    /allows 1 external link/
  );
  await assert.rejects(
    gp.getPayableGuestPost(id, author, { minWords: 1000 }),
    /at least 1000 words/
  );
  // The 3-link package (switchable while unpaid) passes.
  await gp.updateGuestPost({
    id,
    userId: author,
    productId: 'guest_post_premium',
    input: article(2),
    resubmit: false,
    minWords: 10,
  });
  const ok = await gp.getPayableGuestPost(id, author, { minWords: 10 });
  assert.equal(ok.pkg.productId, 'guest_post_premium');
});

test('a draft enters review only by paying, not by resubmitting', async () => {
  const id = await draft();
  await assert.rejects(
    gp.updateGuestPost({
      id,
      userId: author,
      productId: 'guest_post_standard',
      input: article(),
      resubmit: true,
      minWords: 10,
    }),
    /Pay to submit/
  );
});

test('a link whose text is its own URL counts once; code does not count', async () => {
  const { countExternalLinks } = await import('../src/hooks/use-guest-posts');
  const md =
    'Great tool\n\n[https://snapok.app](https://snapok.app)\n\n```\nhttps://in-code.example\n```';
  assert.equal(gp.extractExternalLinks(md).length, 1);
  // The editor's live count uses the same rules as the server.
  assert.equal(countExternalLinks(md), 1);
});

test('bare URLs count as links, images do not', () => {
  assert.equal(
    gp.extractExternalLinks(
      'see https://a.example and [b](https://b.example) ![img](https://c.example/x.png)'
    ).length,
    2
  );
});

test('another user cannot read or edit a submission', async () => {
  const id = await draft();
  assert.equal(await gp.getGuestPost(id, 'someone-else'), null);
  await assert.rejects(
    gp.updateGuestPost({
      id,
      userId: 'someone-else',
      productId: 'guest_post_standard',
      input: article(),
      resubmit: false,
      minWords: 10,
    }),
    /Not found/
  );
});

test('payment submits the draft once, even when webhook and callback race', async () => {
  const id = await draft();
  const stale = await checkoutOrder(id);
  for (let i = 0; i < 3; i++) {
    await settleCheckoutOrder(stale, paid(stale.orderNo), 'stripe');
  }
  const row = await read(id);
  assert.equal(row.submission.status, 'submitted');
  assert.equal(row.submission.orderNo, stale.orderNo);
  assert.equal(row.post.status, 'draft', 'not public before review');
  assert.equal(await posts.findPublishedBySlug(row.post.slug), undefined);
  assert.equal(await orderStatus(stale.orderNo), 'paid');
});

test('a second paid order for the same draft settles but keeps the first', async () => {
  const id = await draft();
  const first = await checkoutOrder(id);
  const second = await checkoutOrder(id);
  await settleCheckoutOrder(first, paid(first.orderNo), 'stripe');
  await settleCheckoutOrder(second, paid(second.orderNo), 'stripe');
  assert.equal((await read(id)).submission.orderNo, first.orderNo);
  assert.equal(await orderStatus(second.orderNo), 'paid', 'refundable');
});

test('once paid, the author cannot edit or delete it', async () => {
  const { id } = await paidSubmission();
  await assert.rejects(
    gp.updateGuestPost({
      id,
      userId: author,
      productId: 'guest_post_standard',
      input: {
        ...article(),
        content: `${words(40)} [x](https://evil.example)`,
      },
      resubmit: false,
      minWords: 10,
    }),
    /can no longer be edited/
  );
  await assert.rejects(gp.deleteGuestPost(id, author), /unpaid drafts/);
});

test('approving publishes at once; a second review is refused', async () => {
  const { id } = await paidSubmission();
  await gp.reviewGuestPost({ id, action: 'approve' });
  const row = await read(id);
  assert.equal(row.submission.status, 'published');
  assert.equal(row.post.status, 'published');
  assert.equal((await posts.findPublishedBySlug(row.post.slug))?.type, 'guest');
  await assert.rejects(
    gp.reviewGuestPost({ id, action: 'request_changes', note: 'late' }),
    /awaiting review/
  );
});

test('changes requested: the author edits and resubmits without paying again', async () => {
  const { id, orderNo } = await paidSubmission();
  await assert.rejects(
    gp.reviewGuestPost({ id, action: 'request_changes' }),
    /what to change/
  );
  await gp.reviewGuestPost({
    id,
    action: 'request_changes',
    note: 'Shorter intro',
  });
  // The package is fixed once paid, even if the request names another.
  await gp.updateGuestPost({
    id,
    userId: author,
    productId: 'guest_post_premium',
    input: article(1, 'How we scaled, v2'),
    resubmit: true,
    minWords: 10,
  });
  const row = await read(id);
  assert.equal(row.submission.status, 'submitted');
  assert.equal(row.submission.productId, 'guest_post_standard');
  assert.equal(row.submission.orderNo, orderNo);
  assert.equal(row.post.title, 'How we scaled, v2');
});

test('rejecting = refunding: the refund marks it rejected, keeps it private', async () => {
  const { id, orderNo } = await paidSubmission();
  await refundOrder({ orderNo, operatorId: 'admin', reason: 'off-topic' });
  await gp.setRejectionNote(id, 'Off-topic');
  const row = await read(id);
  assert.equal(row.submission.status, 'rejected');
  assert.equal(row.submission.reviewNote, 'Off-topic');
  assert.equal(row.post.status, 'draft');
  assert.equal(await orderStatus(orderNo), 'refunded');
  await assert.rejects(
    gp.reviewGuestPost({ id, action: 'approve' }),
    /awaiting review/
  );
});

test('a refund while changes are requested also rejects it', async () => {
  const { id, orderNo } = await paidSubmission();
  await gp.reviewGuestPost({ id, action: 'request_changes', note: 'x' });
  await refundOrder({ orderNo, operatorId: 'admin' });
  assert.equal((await read(id)).submission.status, 'rejected');
});

test('refunding a published guest post takes it down', async () => {
  const { id, orderNo } = await paidSubmission();
  await gp.reviewGuestPost({ id, action: 'approve' });
  await refundOrder({ orderNo, operatorId: 'admin' });
  const row = await read(id);
  assert.equal(row.submission.status, 'unpublished');
  assert.equal(row.post.status, 'archived');
});

test('an unpublished post that is still paid can be republished once', async () => {
  const { id } = await paidSubmission();
  await gp.reviewGuestPost({ id, action: 'approve' });
  await gp.unpublishGuestPost(id, 'Broken link');
  assert.equal((await read(id)).post.status, 'archived');

  await gp.restoreGuestPost({ id, action: 'republish' });
  const row = await read(id);
  assert.equal(row.submission.status, 'published');
  assert.equal(row.post.status, 'published');
  assert.equal(row.orderStatus, 'paid');
  await assert.rejects(
    gp.restoreGuestPost({ id, action: 'republish' }),
    /Only unpublished/
  );
});

test('an unpublished post can go back to the author for free changes', async () => {
  const { id, orderNo } = await paidSubmission();
  await gp.reviewGuestPost({ id, action: 'approve' });
  await gp.unpublishGuestPost(id);
  await assert.rejects(
    gp.restoreGuestPost({ id, action: 'request_changes' }),
    /what to change/
  );
  await gp.restoreGuestPost({ id, action: 'request_changes', note: 'Fix it' });
  let row = await read(id);
  assert.equal(row.submission.status, 'changes_requested');
  assert.equal(row.post.status, 'draft');
  await gp.updateGuestPost({
    id,
    userId: author,
    productId: 'guest_post_standard',
    input: article(1, 'Fixed'),
    resubmit: true,
    minWords: 10,
  });
  row = await read(id);
  assert.equal(row.submission.status, 'submitted');
  assert.equal(row.submission.orderNo, orderNo);
});

test('a refunded post stays down: restoring it is refused', async () => {
  const { id, orderNo } = await paidSubmission();
  await gp.reviewGuestPost({ id, action: 'approve' });
  await refundOrder({ orderNo, operatorId: 'admin' });
  assert.equal((await read(id)).submission.status, 'unpublished');
  for (const action of ['republish', 'request_changes'] as const) {
    await assert.rejects(
      gp.restoreGuestPost({ id, action, note: 'x' }),
      /refunded/
    );
  }
  const row = await read(id);
  assert.equal(row.submission.status, 'unpublished');
  assert.equal(row.post.status, 'archived');
});

test('concurrent restores: exactly one wins', async () => {
  const { id } = await paidSubmission();
  await gp.reviewGuestPost({ id, action: 'approve' });
  await gp.unpublishGuestPost(id);
  const results = await Promise.allSettled([
    gp.restoreGuestPost({ id, action: 'republish' }),
    gp.restoreGuestPost({ id, action: 'republish' }),
    gp.restoreGuestPost({ id, action: 'request_changes', note: 'x' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const row = await read(id);
  assert.ok(['published', 'changes_requested'].includes(row.submission.status));
  assert.equal(
    row.post.status,
    row.submission.status === 'published' ? 'published' : 'draft'
  );
});

test('orders without a guest post reference fulfill nothing extra', () => {
  assert.equal(
    gp.planGuestPostFulfillment({ orderNo: 'X', reference: null }),
    null
  );
  assert.equal(
    gp.planGuestPostFulfillment({ orderNo: 'X', reference: 'other:1' }),
    null
  );
});

test('generic posts API cannot reach guest posts; pages are not blog posts', async () => {
  const listed = await posts.list({ excludeTypes: ['guest'], pageSize: 100 });
  assert.ok(listed.items.every((p: { type: string }) => p.type !== 'guest'));
  await db().insert(post).values({
    id: 'page-1',
    userId: author,
    slug: 'about-us',
    type: 'page',
    title: 'About',
    status: 'published',
  });
  assert.equal(await posts.findPublishedBySlug('about-us'), undefined);
});

test('guest post packages are flagged so the generic checkout refuses them', async () => {
  const { getPricingProduct } = await import('../src/config/pricing');
  assert.equal(getPricingProduct('guest_post_standard')?.kind, 'guest_post');
  assert.equal(getPricingProduct('pro_monthly')?.kind, undefined);
});

test('the admin list leaves out unpaid drafts', async () => {
  const draftId = await draft();
  const { id: paidId } = await paidSubmission();
  const { items } = await gp.listGuestPosts({ pageSize: 100 });
  const ids = items.map((r: { id: string }) => r.id);
  assert.ok(ids.includes(paidId));
  assert.ok(!ids.includes(draftId));
  assert.ok(items.every((r: { status: string }) => r.status !== 'draft'));
  const drafts = await gp.listGuestPosts({ status: 'draft' });
  assert.equal(drafts.total, 0);
});

test('author search filters by title', async () => {
  const { items } = await gp.listUserGuestPosts(author, { search: 'v2' });
  assert.ok(items.length >= 1);
  assert.ok(
    items.every((r: { title: string | null }) => (r.title || '').includes('v2'))
  );
});

test('slugs: custom, normalized, validated and unique across all posts', async () => {
  const id = await gp.createGuestPost({
    userId: author,
    authorName: 'Author',
    productId: 'guest_post_standard',
    input: { ...article(), slug: '  Best Screenshot_Tool ' },
  });
  assert.equal((await read(id)).post.slug, 'best-screenshot-tool');

  await assert.rejects(
    gp.createGuestPost({
      userId: author,
      authorName: 'Author',
      productId: 'guest_post_standard',
      input: { ...article(), slug: 'best-screenshot-tool' },
    }),
    /already taken/
  );
  for (const bad of ['ab', 'café-guide', 'a/b', 'x'.repeat(81)]) {
    await assert.rejects(
      gp.createGuestPost({
        userId: author,
        authorName: 'Author',
        productId: 'guest_post_standard',
        input: { ...article(), slug: bad },
      }),
      /lowercase letters, numbers and hyphens/,
      bad
    );
  }
  // Can't take a regular article's slug either.
  await db().insert(post).values({
    id: 'article-1',
    userId: author,
    slug: 'launch-notes',
    type: 'article',
    title: 'Launch notes',
    status: 'published',
  });
  await assert.rejects(
    gp.updateGuestPost({
      id,
      userId: author,
      productId: 'guest_post_standard',
      input: { ...article(), slug: 'launch-notes' },
      resubmit: false,
      minWords: 10,
    }),
    /already taken/
  );
  // Empty keeps the current slug.
  await gp.updateGuestPost({
    id,
    userId: author,
    productId: 'guest_post_standard',
    input: { ...article(), slug: '' },
    resubmit: false,
    minWords: 10,
  });
  assert.equal((await read(id)).post.slug, 'best-screenshot-tool');
});

test('slugs from titles: clean when free, suffixed on a clash, safe for CJK', async () => {
  const make = (title: string) =>
    gp.createGuestPost({
      userId: author,
      authorName: 'Author',
      productId: 'guest_post_standard',
      input: { ...article(1, title) },
    });
  const a = await read(await make('Unique Title For Slug'));
  assert.equal(a.post.slug, 'unique-title-for-slug');
  const b = await read(await make('Unique Title For Slug'));
  assert.match(b.post.slug, /^unique-title-for-slug-[a-f0-9]{6}$/);
  const c = await read(await make('最好的截图软件'));
  assert.match(c.post.slug, /^guest-[a-f0-9]{6}$/);
});

test('admins can change the slug, even after publishing', async () => {
  const { id } = await paidSubmission();
  await gp.reviewGuestPost({ id, action: 'approve' });
  const before = await read(id);
  await gp.adminEditGuestPost(id, {
    title: before.post.title || '',
    content: before.post.content || '',
    slug: 'renamed-by-admin',
  });
  assert.equal((await read(id)).post.slug, 'renamed-by-admin');
  assert.equal(
    (await posts.findPublishedBySlug('renamed-by-admin'))?.type,
    'guest'
  );
  assert.equal(await posts.findPublishedBySlug(before.post.slug), undefined);
});

test('guest post links get utm tags unless the author already set some', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MarkdownContent } =
    await import('../src/components/markdown-content');
  const hrefs = (props: Record<string, unknown>) =>
    [
      ...renderToStaticMarkup(
        React.createElement(MarkdownContent, props as any)
      ).matchAll(/href="([^"]+)"/g),
    ].map((m) => m[1].replace(/&amp;/g, '&'));
  const md =
    '[a](https://snapok.app) [b](https://x.example/p?utm_source=mine) [c](https://y.example/?q=1#top) [d](/internal)';
  assert.deepEqual(
    hrefs({
      content: md,
      sponsored: true,
      utm: { source: 'shipany.site', medium: 'guest_post' },
    }),
    [
      'https://snapok.app/?utm_source=shipany.site&utm_medium=guest_post',
      'https://x.example/p?utm_source=mine',
      'https://y.example/?q=1&utm_source=shipany.site&utm_medium=guest_post#top',
      '/internal',
    ]
  );
  // Regular posts are untouched.
  assert.deepEqual(hrefs({ content: '[a](https://snapok.app)' }), [
    'https://snapok.app',
  ]);
});
