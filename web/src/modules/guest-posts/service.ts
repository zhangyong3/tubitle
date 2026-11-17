import { and, count, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';

import { db } from '@/core/db';
import { atomic, AtomicGuardError, guard } from '@/core/db/atomic';
import { guestPost, order, post, user } from '@/config/db/schema';
import { getPricingProduct, type PricingProduct } from '@/config/pricing';
import { countWords, extractExternalLinks } from '@/lib/guest-post-rules';
import { getUuid } from '@/lib/hash';
import { keywordMatch } from '@/lib/sql-search';

/**
 * Guest posts: outside authors write an article and pay for it, which
 * submits it for review; an admin then publishes it, asks for changes (the
 * author resubmits without paying again) or rejects it, which refunds.
 *
 * The body lives in `post` (type 'guest'), kept in 'draft' until published,
 * so the blog never shows an unreviewed article. Status changes are
 * conditional writes (atomic + guard) so two reviewers, or a review racing an
 * edit, can't both win. Money moves only through the payment flow:
 * planGuestPostFulfillment() submits a paid draft, planGuestPostRefund()
 * rejects (or takes down) the submission a refunded order paid for.
 */

export const GUEST_POST_TYPE = 'guest';

export enum GuestPostStatus {
  DRAFT = 'draft', // unpaid, editable
  SUBMITTED = 'submitted', // paid, awaiting review
  CHANGES_REQUESTED = 'changes_requested', // paid, editable, resubmit free
  PUBLISHED = 'published',
  REJECTED = 'rejected', // refunded
  UNPUBLISHED = 'unpublished', // taken down after publishing
}

/** The author may edit in these states. */
const EDITABLE = [GuestPostStatus.DRAFT, GuestPostStatus.CHANGES_REQUESTED];

export const GUEST_POST_LIMITS = {
  title: 200,
  description: 500,
  content: 50_000,
  url: 2048,
  reviewNote: 2000,
};

export class GuestPostError extends Error {}

export type GuestPostInput = {
  title: string;
  /** URL slug (/blog/<slug>); empty = derived from the title. */
  slug?: string;
  description?: string;
  image?: string;
  content: string;
};

// ─── Validation ──────────────────────────────────────────────────────────────

/** The guest post package for `productId`, or null if it isn't one. */
export function getGuestPostPackage(productId: string): PricingProduct | null {
  const product = getPricingProduct(productId);
  return product?.kind === 'guest_post' ? product : null;
}

function isSafeImageUrl(url: string): boolean {
  if (url.length > GUEST_POST_LIMITS.url) return false;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  return /^https?:\/\//i.test(url);
}

/** Normalized fields, or a GuestPostError. Length/URL checks only. */
function cleanInput(input: GuestPostInput) {
  const title = (input.title || '').trim();
  const description = (input.description || '').trim();
  const image = (input.image || '').trim();
  const content = input.content || '';
  if (!title) throw new GuestPostError('Title is required');
  if (title.length > GUEST_POST_LIMITS.title)
    throw new GuestPostError('Title is too long');
  if (description.length > GUEST_POST_LIMITS.description)
    throw new GuestPostError('Summary is too long');
  if (content.length > GUEST_POST_LIMITS.content)
    throw new GuestPostError('Article is too long');
  if (image && !isSafeImageUrl(image))
    throw new GuestPostError('Invalid cover image URL');
  return { title, description, image, content };
}

/**
 * Checks before an article enters review (on payment or resubmit): length
 * and the package's link cap.
 */
export function validateForReview(
  input: GuestPostInput,
  pkg: PricingProduct,
  opts: { minWords: number }
) {
  const clean = cleanInput(input);
  const words = countWords(clean.content);
  if (words < opts.minWords) {
    throw new GuestPostError(
      `The article needs at least ${opts.minWords} words (now ${words})`
    );
  }
  const links = extractExternalLinks(clean.content).length;
  const maxLinks = pkg.maxLinks ?? 0;
  if (links > maxLinks) {
    throw new GuestPostError(
      `This package allows ${maxLinks} external link(s); the article has ${links}`
    );
  }
  return clean;
}

export { countWords, extractExternalLinks };

// ─── Slugs ───────────────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_LIMITS = { min: 3, max: 80 };

/**
 * A chosen slug in canonical form (lowercase, hyphens), or null when left
 * empty. Throws when it can't be a clean URL segment.
 */
export function normalizeSlug(raw: string | undefined | null): string | null {
  const slug = (raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) return null;
  if (
    !SLUG_RE.test(slug) ||
    slug.length < SLUG_LIMITS.min ||
    slug.length > SLUG_LIMITS.max
  ) {
    throw new GuestPostError(
      `The URL slug may only use lowercase letters, numbers and hyphens (${SLUG_LIMITS.min}–${SLUG_LIMITS.max} characters)`
    );
  }
  return slug;
}

async function slugTaken(slug: string, exceptPostId?: string) {
  const [row] = await db()
    .select({ id: post.id })
    .from(post)
    .where(eq(post.slug, slug))
    .limit(1);
  return !!row && row.id !== exceptPostId;
}

async function assertSlugAvailable(slug: string, exceptPostId?: string) {
  if (await slugTaken(slug, exceptPostId)) {
    throw new GuestPostError('This URL slug is already taken');
  }
}

/** Slug from the title; a random suffix only if that one is taken. */
async function slugFromTitle(title: string) {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  const suffix = () => getUuid().replace(/-/g, '').slice(0, 6);
  // Titles with no Latin letters (e.g. Chinese) leave nothing to use.
  if (base.length < SLUG_LIMITS.min) return `guest-${suffix()}`;
  return (await slugTaken(base)) ? `${base}-${suffix()}` : base;
}

/** The unique index on post.slug caught a race the lookup missed. */
function slugRace(e: unknown): never {
  const text =
    String((e as any)?.message ?? e) + String((e as any)?.cause ?? '');
  if (/unique|duplicate/i.test(text) && /slug/i.test(text)) {
    throw new GuestPostError('This URL slug is already taken');
  }
  throw e;
}

function rethrow(e: unknown): never {
  if (e instanceof AtomicGuardError) throw new GuestPostError(e.message);
  slugRace(e);
}

// ─── Reads ───────────────────────────────────────────────────────────────────

const listColumns = {
  id: guestPost.id,
  postId: guestPost.postId,
  productId: guestPost.productId,
  status: guestPost.status,
  reviewNote: guestPost.reviewNote,
  orderNo: guestPost.orderNo,
  submittedAt: guestPost.submittedAt,
  publishedAt: guestPost.publishedAt,
  createdAt: guestPost.createdAt,
  updatedAt: guestPost.updatedAt,
  title: post.title,
  slug: post.slug,
};

async function page(
  where: SQL | undefined,
  { page = 1, pageSize = 20 }: { page?: number; pageSize?: number },
  withUser = false
) {
  const [{ total }] = await db()
    .select({ total: count() })
    .from(guestPost)
    .innerJoin(post, eq(post.id, guestPost.postId))
    .leftJoin(user, eq(user.id, guestPost.userId))
    .where(where);
  const items = await db()
    .select({
      ...listColumns,
      ...(withUser
        ? {
            userId: guestPost.userId,
            userName: user.name,
            userEmail: user.email,
            userAvatar: user.image,
          }
        : {}),
    })
    .from(guestPost)
    .innerJoin(post, eq(post.id, guestPost.postId))
    .leftJoin(user, eq(user.id, guestPost.userId))
    .where(where)
    .orderBy(desc(guestPost.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items, total };
}

export function listUserGuestPosts(
  userId: string,
  opts: {
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}
) {
  return page(
    and(
      eq(guestPost.userId, userId),
      opts.status ? eq(guestPost.status, opts.status) : undefined,
      keywordMatch(opts.search, { contains: [post.title] })
    ),
    opts
  );
}

export function listGuestPosts(
  opts: {
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}
) {
  const where = and(
    // Unpaid drafts are the author's business, not the review queue's.
    ne(guestPost.status, GuestPostStatus.DRAFT),
    opts.status ? eq(guestPost.status, opts.status) : undefined,
    keywordMatch(opts.search, {
      contains: [post.title, user.email, user.name],
      exact: [guestPost.id, guestPost.orderNo],
    })
  );
  return page(where, opts, true);
}

/** Submission plus its article. `userId` restricts to the owner. */
export async function getGuestPost(id: string, userId?: string) {
  const [row] = await db()
    .select({
      submission: guestPost,
      post: {
        id: post.id,
        slug: post.slug,
        title: post.title,
        description: post.description,
        image: post.image,
        content: post.content,
        status: post.status,
      },
      userName: user.name,
      userEmail: user.email,
      userAvatar: user.image,
      orderStatus: order.status,
    })
    .from(guestPost)
    .innerJoin(post, eq(post.id, guestPost.postId))
    .leftJoin(user, eq(user.id, guestPost.userId))
    .leftJoin(order, eq(order.orderNo, guestPost.orderNo))
    .where(
      and(
        eq(guestPost.id, id),
        userId ? eq(guestPost.userId, userId) : undefined
      )
    )
    .limit(1);
  return row ?? null;
}

/** A guest post's article by slug in any state, with its author, for previews. */
export async function findGuestPostBySlug(slug: string) {
  const [row] = await db()
    .select({
      post,
      authorId: guestPost.userId,
      guestPostId: guestPost.id,
      status: guestPost.status,
      productId: guestPost.productId,
    })
    .from(post)
    .innerJoin(guestPost, eq(guestPost.postId, post.id))
    .where(
      and(eq(post.slug, slug.toLowerCase()), eq(post.type, GUEST_POST_TYPE))
    )
    .limit(1);
  return row ?? null;
}

// ─── Author actions ──────────────────────────────────────────────────────────

export async function createGuestPost(params: {
  userId: string;
  authorName: string;
  authorImage?: string | null;
  productId: string;
  input: GuestPostInput;
}) {
  if (!getGuestPostPackage(params.productId)) {
    throw new GuestPostError('Unknown package');
  }
  const clean = cleanInput(params.input);
  const chosen = normalizeSlug(params.input.slug);
  if (chosen) await assertSlugAvailable(chosen);
  const slug = chosen ?? (await slugFromTitle(clean.title));
  const postId = getUuid();
  const id = getUuid();
  await atomic((q) => [
    q.insert(post).values({
      id: postId,
      userId: params.userId,
      slug,
      type: GUEST_POST_TYPE,
      title: clean.title,
      description: clean.description,
      image: clean.image,
      content: clean.content,
      authorName: params.authorName,
      authorImage: params.authorImage || '',
      status: 'draft',
    }),
    q.insert(guestPost).values({
      id,
      userId: params.userId,
      postId,
      productId: params.productId,
      status: GuestPostStatus.DRAFT,
    }),
  ]).catch(slugRace);
  return id;
}

/**
 * Edit. `resubmit` sends a changes-requested (already paid) submission back
 * to review; a draft enters review only by paying (see checkout). The package
 * can change only while unpaid.
 */
export async function updateGuestPost(params: {
  id: string;
  userId: string;
  productId: string;
  input: GuestPostInput;
  resubmit: boolean;
  minWords: number;
}) {
  const existing = await getGuestPost(params.id, params.userId);
  if (!existing) throw new GuestPostError('Not found');
  const status = existing.submission.status as GuestPostStatus;
  if (!EDITABLE.includes(status)) {
    throw new GuestPostError('This submission can no longer be edited');
  }
  if (params.resubmit && status !== GuestPostStatus.CHANGES_REQUESTED) {
    throw new GuestPostError('Pay to submit this article for review');
  }
  const productId =
    status === GuestPostStatus.DRAFT
      ? params.productId
      : existing.submission.productId;
  const pkg = getGuestPostPackage(productId);
  if (!pkg) throw new GuestPostError('Unknown package');
  const clean = params.resubmit
    ? validateForReview(params.input, pkg, { minWords: params.minWords })
    : cleanInput(params.input);
  // Empty keeps the current slug.
  const slug = normalizeSlug(params.input.slug) ?? existing.post.slug;
  if (slug !== existing.post.slug) {
    await assertSlugAvailable(slug, existing.post.id);
  }

  try {
    await atomic((q) => [
      guard({
        table: guestPost,
        column: 'userId',
        where: eq(guestPost.id, params.id),
        require: eq(guestPost.status, status),
        message: 'This submission can no longer be edited',
      }),
      q
        .update(post)
        .set({
          slug,
          title: clean.title,
          description: clean.description,
          image: clean.image,
          content: clean.content,
        })
        .where(eq(post.id, existing.post.id)),
      q
        .update(guestPost)
        .set({
          productId,
          ...(params.resubmit
            ? { status: GuestPostStatus.SUBMITTED, submittedAt: new Date() }
            : {}),
        })
        .where(eq(guestPost.id, params.id)),
    ]);
  } catch (e) {
    rethrow(e);
  }
}

export async function deleteGuestPost(id: string, userId: string) {
  const existing = await getGuestPost(id, userId);
  if (!existing) throw new GuestPostError('Not found');
  if (existing.submission.status !== GuestPostStatus.DRAFT) {
    throw new GuestPostError('Only unpaid drafts can be deleted');
  }
  try {
    await atomic((q) => [
      guard({
        table: guestPost,
        column: 'userId',
        where: eq(guestPost.id, id),
        require: eq(guestPost.status, GuestPostStatus.DRAFT),
        message: 'Only unpaid drafts can be deleted',
      }),
      // Cascades to guest_post.
      q.delete(post).where(eq(post.id, existing.post.id)),
    ]);
  } catch (e) {
    rethrow(e);
  }
}

/**
 * The draft and its package, checked for review, if the author may pay for
 * it now. Paying submits it.
 */
export async function getPayableGuestPost(
  id: string,
  userId: string,
  opts: { minWords: number }
) {
  const existing = await getGuestPost(id, userId);
  if (!existing) throw new GuestPostError('Not found');
  if (existing.submission.status !== GuestPostStatus.DRAFT) {
    throw new GuestPostError('This submission is already paid');
  }
  const pkg = getGuestPostPackage(existing.submission.productId);
  if (!pkg) throw new GuestPostError('Unknown package');
  validateForReview(
    {
      title: existing.post.title || '',
      description: existing.post.description || '',
      image: existing.post.image || '',
      content: existing.post.content || '',
    },
    pkg,
    opts
  );
  return { ...existing, pkg };
}

const REFERENCE_PREFIX = 'guest_post:';

/** order.reference for a checkout that pays for this submission. */
export function guestPostOrderReference(guestPostId: string) {
  return `${REFERENCE_PREFIX}${guestPostId}`;
}

// ─── Admin actions ───────────────────────────────────────────────────────────

export type ReviewAction = 'approve' | 'request_changes';

/**
 * Approve (publishes at once) or ask for changes. Rejecting refunds, so it
 * goes through the payment flow instead (see the admin reject handler).
 */
export async function reviewGuestPost(params: {
  id: string;
  action: ReviewAction;
  note?: string;
}) {
  const existing = await getGuestPost(params.id);
  if (!existing) throw new GuestPostError('Not found');
  const note = (params.note || '')
    .trim()
    .slice(0, GUEST_POST_LIMITS.reviewNote);
  if (params.action === 'request_changes' && !note) {
    throw new GuestPostError('Tell the author what to change');
  }
  const claim = guard({
    table: guestPost,
    column: 'userId',
    where: eq(guestPost.id, params.id),
    require: eq(guestPost.status, GuestPostStatus.SUBMITTED),
    message: 'Only submissions awaiting review can be reviewed',
  });
  const now = new Date();

  try {
    if (params.action === 'approve') {
      await atomic((q) => [
        claim,
        q
          .update(guestPost)
          .set({
            status: GuestPostStatus.PUBLISHED,
            reviewNote: note || null,
            publishedAt: now,
          })
          .where(eq(guestPost.id, params.id)),
        q
          .update(post)
          .set({ status: 'published', createdAt: now })
          .where(eq(post.id, existing.post.id)),
      ]);
    } else {
      await atomic((q) => [
        claim,
        q
          .update(guestPost)
          .set({ status: GuestPostStatus.CHANGES_REQUESTED, reviewNote: note })
          .where(eq(guestPost.id, params.id)),
      ]);
    }
  } catch (e) {
    rethrow(e);
  }
  return existing;
}

/** Record why a refunded submission was rejected (after the refund). */
export async function setRejectionNote(id: string, note: string) {
  await db()
    .update(guestPost)
    .set({
      reviewNote: note.trim().slice(0, GUEST_POST_LIMITS.reviewNote) || null,
    })
    .where(
      and(eq(guestPost.id, id), eq(guestPost.status, GuestPostStatus.REJECTED))
    );
}

/**
 * Admin fixes to the article, slug included. Any state; edits a published
 * one live (a new slug breaks its old URL; the UI warns first).
 */
export async function adminEditGuestPost(id: string, input: GuestPostInput) {
  const existing = await getGuestPost(id);
  if (!existing) throw new GuestPostError('Not found');
  const clean = cleanInput(input);
  const slug = normalizeSlug(input.slug) ?? existing.post.slug;
  if (slug !== existing.post.slug) {
    await assertSlugAvailable(slug, existing.post.id);
  }
  const pkg = getGuestPostPackage(existing.submission.productId);
  const links = extractExternalLinks(clean.content).length;
  if (pkg && links > (pkg.maxLinks ?? 0)) {
    throw new GuestPostError(
      `This package allows ${pkg.maxLinks} external link(s); the article has ${links}`
    );
  }
  await db()
    .update(post)
    .set({
      slug,
      title: clean.title,
      description: clean.description,
      image: clean.image,
      content: clean.content,
    })
    .where(eq(post.id, existing.post.id))
    .catch(slugRace);
}

/** Take a published guest post down (stays paid; refund separately). */
export async function unpublishGuestPost(id: string, note?: string) {
  const existing = await getGuestPost(id);
  if (!existing) throw new GuestPostError('Not found');
  try {
    await atomic((q) => [
      guard({
        table: guestPost,
        column: 'userId',
        where: eq(guestPost.id, id),
        require: eq(guestPost.status, GuestPostStatus.PUBLISHED),
        message: 'Only published guest posts can be unpublished',
      }),
      q
        .update(guestPost)
        .set({
          status: GuestPostStatus.UNPUBLISHED,
          reviewNote:
            (note || '').trim().slice(0, GUEST_POST_LIMITS.reviewNote) || null,
        })
        .where(eq(guestPost.id, id)),
      q
        .update(post)
        .set({ status: 'archived' })
        .where(eq(post.id, existing.post.id)),
    ]);
  } catch (e) {
    rethrow(e);
  }
}

// ─── Payment flow (called by modules/payment) ────────────────────────────────

/**
 * Steps that submit the draft an order paid for, to bundle into the payment
 * settlement's atomic write. Null when the order isn't for a guest post.
 * A conditional update, not a guard: the payment must settle even if the
 * draft was already paid by another order (an admin refunds the extra one).
 */
export function planGuestPostFulfillment(o: {
  orderNo: string;
  reference: string | null;
}) {
  if (!o.reference?.startsWith(REFERENCE_PREFIX)) return null;
  const guestPostId = o.reference.slice(REFERENCE_PREFIX.length);
  return {
    guestPostId,
    steps: (q: any) => [
      q
        .update(guestPost)
        .set({
          status: GuestPostStatus.SUBMITTED,
          orderNo: o.orderNo,
          submittedAt: new Date(),
        })
        .where(
          and(
            eq(guestPost.id, guestPostId),
            eq(guestPost.status, GuestPostStatus.DRAFT)
          )
        ),
    ],
  };
}

export type RestoreAction = 'republish' | 'request_changes';

/**
 * Bring back a guest post that was taken down: republish it, or send it back
 * to the author for changes (resubmitting stays free). Only while its order is
 * still paid, so a refunded article never returns without payment.
 */
export async function restoreGuestPost(params: {
  id: string;
  action: RestoreAction;
  note?: string;
}) {
  const existing = await getGuestPost(params.id);
  if (!existing) throw new GuestPostError('Not found');
  const note = (params.note || '')
    .trim()
    .slice(0, GUEST_POST_LIMITS.reviewNote);
  if (params.action === 'request_changes' && !note) {
    throw new GuestPostError('Tell the author what to change');
  }
  const { orderNo } = existing.submission;
  if (!orderNo) throw new GuestPostError('This guest post was never paid');

  const steps = (q: any) => [
    guard({
      table: guestPost,
      column: 'userId',
      where: eq(guestPost.id, params.id),
      require: eq(guestPost.status, GuestPostStatus.UNPUBLISHED),
      message: 'Only unpublished guest posts can be restored',
    }),
    guard({
      table: order,
      column: 'userId',
      where: eq(order.orderNo, orderNo),
      require: eq(order.status, 'paid'),
      message: 'Its order was refunded; it cannot be restored',
    }),
    ...(params.action === 'republish'
      ? [
          q
            .update(guestPost)
            .set({
              status: GuestPostStatus.PUBLISHED,
              reviewNote: note || null,
            })
            .where(eq(guestPost.id, params.id)),
          q
            .update(post)
            .set({ status: 'published' })
            .where(eq(post.id, existing.post.id)),
        ]
      : [
          q
            .update(guestPost)
            .set({
              status: GuestPostStatus.CHANGES_REQUESTED,
              reviewNote: note,
            })
            .where(eq(guestPost.id, params.id)),
          // Private again until approved, like any submission under review.
          q
            .update(post)
            .set({ status: 'draft' })
            .where(eq(post.id, existing.post.id)),
        ]),
  ];
  try {
    await atomic(steps);
  } catch (e) {
    rethrow(e);
  }
  return existing;
}

/**
 * Steps for a refunded order, bundled into the refund's atomic write: the
 * submission it paid for is rejected, or taken down if already published.
 * So a refund from the Payments page and "reject" here end the same way.
 */
export function planGuestPostRefund(orderNo: string) {
  const paidBy = eq(guestPost.orderNo, orderNo);
  return (q: any) => [
    q
      .update(post)
      .set({ status: 'archived' })
      .where(
        sql`${post.id} in (select ${guestPost.postId} from ${guestPost} where ${guestPost.orderNo} = ${orderNo} and ${guestPost.status} = ${GuestPostStatus.PUBLISHED})`
      ),
    q
      .update(guestPost)
      .set({ status: GuestPostStatus.UNPUBLISHED })
      .where(and(paidBy, eq(guestPost.status, GuestPostStatus.PUBLISHED))),
    q
      .update(guestPost)
      .set({ status: GuestPostStatus.REJECTED })
      .where(
        and(
          paidBy,
          inArray(guestPost.status, [
            GuestPostStatus.SUBMITTED,
            GuestPostStatus.CHANGES_REQUESTED,
          ])
        )
      ),
  ];
}
