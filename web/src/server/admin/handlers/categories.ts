import * as taxonomyService from '@/modules/taxonomy/service';
import { respData, respErr, respOk, respPage } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

export async function GET({ request, actor }: AdminHandlerContext) {
  try {
    const { searchParams } = new URL(request.url);

    // If ?all=true, return all categories (for dropdowns)
    if (searchParams.get('all') === 'true') {
      const items = await taxonomyService.getAll('category');
      return respData(items);
    }

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('pageSize') || '20'))
    );
    const search = searchParams.get('search') || undefined;

    const { items, total } = await taxonomyService.list({
      type: 'category',
      search,
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
    const { slug, title, description } = await request.json();
    if (!slug || !title) return respErr('slug and title are required');
    const result = await taxonomyService.create({
      userId: actor.userId,
      slug,
      type: 'category',
      title,
      description,
    });
    return respData(result);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function PUT({ request, actor }: AdminHandlerContext) {
  try {
    const { id, slug, title, description, status } = await request.json();
    if (!id) return respErr('ID is required');
    const result = await taxonomyService.update(id, {
      slug,
      title,
      description,
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
    await taxonomyService.remove(id);
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
