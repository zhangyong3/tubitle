import { createServerFn } from '@tanstack/react-start';

import {
  getLocalPosts,
  loadLocalPost,
  mergePosts,
  type BlogPost,
  type BlogPostDetail,
} from './index';

// Database access stays behind server functions (dynamic import keeps
// drizzle out of the client bundle), mirroring the analytics pattern.

async function getDbPosts(): Promise<BlogPost[]> {
  try {
    const { listPublishedArticles } = await import('@/modules/posts/service');
    const rows = await listPublishedArticles();
    return rows.map((row) => ({
      slug: row.slug,
      title: row.title || row.slug,
      description: row.description || '',
      image: row.image || undefined,
      createdAt: new Date(row.createdAt).toISOString(),
      authorName: row.authorName || undefined,
      authorImage: row.authorImage || undefined,
      source: 'db' as const,
      sponsored: row.type === 'guest',
    }));
  } catch {
    // Database not configured/reachable — local posts still render.
    return [];
  }
}

/**
 * All blog posts: database posts merged with local MDX posts,
 * deduped by slug (database wins), newest first.
 */
export const getBlogPostsFn = createServerFn()
  .validator((data: { locale: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    const dbPosts = await getDbPosts();
    return mergePosts(dbPosts, getLocalPosts(data.locale), {
      limit: data.limit,
    });
  });

/**
 * Single blog post by slug: database first, local MDX as fallback.
 * Local posts return meta only — the route component resolves the MDX
 * Content from the bundled glob map (components don't serialize).
 */
export const getBlogPostFn = createServerFn()
  .validator((data: { slug: string; locale: string }) => data)
  .handler(async ({ data }): Promise<BlogPostDetail | null> => {
    try {
      const { findPublishedBySlug } = await import('@/modules/posts/service');
      const row = await findPublishedBySlug(data.slug);
      if (row) {
        return {
          slug: row.slug,
          title: row.title || row.slug,
          description: row.description || '',
          image: row.image || undefined,
          createdAt: new Date(row.createdAt).toISOString(),
          authorName: row.authorName || undefined,
          authorImage: row.authorImage || undefined,
          source: 'db',
          sponsored: row.type === 'guest',
          content: row.content || '',
        };
      }
    } catch {
      // Database not configured/reachable — fall through to local posts.
    }

    const mod = loadLocalPost(data.slug, data.locale);
    if (!mod) return null;
    const meta = mod.meta;
    return {
      slug: data.slug,
      title: meta.title,
      description: meta.description,
      image: meta.image,
      createdAt: new Date(meta.created_at).toISOString(),
      authorName: meta.author_name,
      authorImage: meta.author_image,
      source: 'local',
    };
  });

/** Whether the site accepts guest posts (the blog links to /guest-post). */
export const getGuestPostsOpenFn = createServerFn().handler(async () => {
  try {
    const { getAllConfigs } = await import('@/modules/config/service');
    const configs = await getAllConfigs();
    return configs.guest_post_enabled === 'true';
  } catch {
    return false;
  }
});

/**
 * An unpublished guest post, rendered in the blog layout for its author or a
 * reviewer (admin.guest-posts.read). Null for anyone else, so the page 404s.
 */
export const getBlogPreviewFn = createServerFn()
  .validator((data: { slug: string }) => data)
  .handler(async ({ data }): Promise<BlogPostDetail | null> => {
    try {
      const { getRequest } = await import('@tanstack/react-start/server');
      const { getAuth } = await import('@/core/auth');
      const session = await getAuth().api.getSession({
        headers: getRequest().headers,
      });
      if (!session?.user) return null;

      const { findGuestPostBySlug } =
        await import('@/modules/guest-posts/service');
      const row = await findGuestPostBySlug(data.slug);
      if (!row) return null;
      if (row.authorId !== session.user.id) {
        const { hasPermission } = await import('@/modules/rbac/service');
        if (!(await hasPermission(session.user.id, 'admin.guest-posts.read'))) {
          return null;
        }
      }
      const p = row.post;
      const { getPricingProduct } = await import('@/config/pricing');
      const pkg = getPricingProduct(row.productId);
      const { getAllConfigs } = await import('@/modules/config/service');
      const { guestPostSettings } =
        await import('@/server/guest-posts/settings');
      const { minWords } = guestPostSettings(await getAllConfigs());
      return {
        slug: p.slug,
        title: p.title || p.slug,
        description: p.description || '',
        image: p.image || undefined,
        createdAt: new Date(p.createdAt).toISOString(),
        authorName: p.authorName || undefined,
        authorImage: p.authorImage || undefined,
        source: 'db',
        sponsored: true,
        preview: p.status !== 'published',
        previewInfo: {
          guestPostId: row.guestPostId,
          status: row.status,
          isAuthor: row.authorId === session.user.id,
          priceInCents: pkg?.priceInCents ?? 0,
          currency: pkg?.currency ?? 'usd',
          minWords,
          maxLinks: pkg?.maxLinks ?? 0,
        },
        content: p.content || '',
      };
    } catch {
      return null;
    }
  });
