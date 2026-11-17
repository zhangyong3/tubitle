import * as postsService from '@/modules/posts/service';
import { respData, respErr, respOk, respPage } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

// Guest posts are paid content: they're published only by payment and edited
// under Guest posts, never through the generic posts API.
const GUEST_ONLY = 'Guest posts are managed under Guest posts';
async function isGuestPost(id: string) {
  const post = await postsService.getById(id);
  return post?.type === postsService.PostType.GUEST;
}

export async function GET({ request, actor }: AdminHandlerContext) {
  try {
    const { searchParams } = new URL(request.url);

    // Single post (with content) — used by the editor
    const id = searchParams.get('id');
    if (id) {
      const post = await postsService.getById(id);
      if (!post) return respErr('Post not found');
      if (post.type === postsService.PostType.GUEST) return respErr(GUEST_ONLY);
      return respData(post);
    }

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('pageSize') || '20'))
    );
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') || undefined;

    const { items, total } = await postsService.list({
      excludeTypes: [postsService.PostType.GUEST],
      search,
      status,
      page,
      pageSize,
    });
    return respPage(items, total);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function POST({ request, actor }: AdminHandlerContext) {
  try {
    const {
      slug,
      title,
      description,
      image,
      content,
      categories,
      authorName,
      status,
    } = await request.json();
    if (!slug || !title) return respErr('slug and title are required');
    const result = await postsService.create({
      userId: actor.userId,
      slug,
      title,
      description,
      image,
      content,
      categories,
      authorName,
      status,
    });
    return respData(result);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function PUT({ request, actor }: AdminHandlerContext) {
  try {
    const {
      id,
      slug,
      title,
      description,
      image,
      content,
      categories,
      authorName,
      status,
    } = await request.json();
    if (!id) return respErr('ID is required');
    if (await isGuestPost(id)) return respErr(GUEST_ONLY);
    const result = await postsService.update(id, {
      slug,
      title,
      description,
      image,
      content,
      categories,
      authorName,
      status,
    });
    return respData(result);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function DELETE({ request, actor }: AdminHandlerContext) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return respErr('ID is required');
    if (await isGuestPost(id)) return respErr(GUEST_ONLY);
    await postsService.remove(id);
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
