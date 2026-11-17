import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ExternalLink, Eye, Pencil, Plus } from 'lucide-react';

import { tDynamic } from '@/core/i18n/dynamic';
import { Link } from '@/core/i18n/navigation';
import { apiGet, pageQuery, type PageResult } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { localizeHref } from '@/paraglide/runtime.js';
import {
  formatDate,
  packageLabel,
  useGuestPostInfo,
  type GuestPostRow,
} from '@/hooks/use-guest-posts';
import { DataTable, type Column } from '@/components/data-table';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  ArticleUrl,
  GuestPostStatusBadge,
  PackageCell,
  ReviewNoteCell,
} from './-shared';

const PAGE_SIZE = 20;
const EDITABLE = ['draft', 'changes_requested'];
const STATUSES = [
  'draft',
  'submitted',
  'changes_requested',
  'published',
  'rejected',
  'unpublished',
];

function GuestPostsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('all');
  const info = useGuestPostInfo();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [debounced, status]);

  const listQuery = useQuery({
    queryKey: ['guest-posts', page, debounced, status],
    queryFn: () =>
      apiGet<PageResult<GuestPostRow>>(
        pageQuery('/api/guest-posts', {
          page,
          pageSize: PAGE_SIZE,
          search: debounced,
        }) + (status === 'all' ? '' : `&status=${status}`)
      ),
    placeholderData: keepPreviousData,
  });

  const action = cn(
    buttonVariants({ variant: 'ghost', size: 'sm' }),
    'h-7 gap-1 px-2 text-xs'
  );
  const columns: Column<GuestPostRow>[] = [
    {
      header: m['guest_posts.title_col'](),
      cell: (r) => (
        <div className="min-w-0">
          <Link
            href={`/settings/guest-posts/${r.id}`}
            className="font-medium hover:underline"
          >
            {r.title || '—'}
          </Link>
          <ArticleUrl slug={r.slug} status={r.status} />
        </div>
      ),
    },
    {
      header: m['guest_posts.package_col'](),
      className: 'w-[180px]',
      cell: (r) => (
        <PackageCell productId={r.productId} packages={info.data?.packages} />
      ),
    },
    {
      header: m['guest_posts.status_col'](),
      className: 'w-[150px]',
      cell: (r) => <GuestPostStatusBadge status={r.status} />,
    },
    {
      header: m['guest_posts.review_note'](),
      className: 'min-w-[220px]',
      cell: (r) => <ReviewNoteCell status={r.status} note={r.reviewNote} />,
    },
    {
      header: m['guest_posts.updated_col'](),
      className: 'w-[180px]',
      cell: (r) => (
        <span className="text-muted-foreground">{formatDate(r.updatedAt)}</span>
      ),
    },
    {
      header: m['guest_posts.actions_col'](),
      className: 'w-[190px]',
      cell: (r) => (
        <div className="flex items-center gap-1">
          <Link href={`/settings/guest-posts/${r.id}`} className={action}>
            <Pencil className="size-3.5" />
            {EDITABLE.includes(r.status)
              ? m['guest_posts.edit']()
              : m['guest_posts.view']()}
          </Link>
          {r.slug && r.status === 'published' && (
            <a
              href={localizeHref(`/blog/${r.slug}`)}
              target="_blank"
              rel="noopener"
              className={action}
            >
              <ExternalLink className="size-3.5" />
              {m['guest_posts.view_article']()}
            </a>
          )}
          {r.slug && r.status !== 'published' && (
            <a
              href={localizeHref(`/blog/${r.slug}?preview=1`)}
              target="_blank"
              rel="noopener"
              className={action}
            >
              <Eye className="size-3.5" />
              {m['guest_posts.preview']()}
            </a>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{m['guest_posts.title']()}</h1>
          <p className="text-muted-foreground">
            {m['guest_posts.description']()}
          </p>
        </div>
        {info.data?.enabled && (
          <Link
            href="/settings/guest-posts/new"
            className={cn(buttonVariants(), 'gap-2')}
          >
            <Plus className="size-4" />
            {m['guest_posts.new_button']()}
          </Link>
        )}
      </div>

      {info.data && !info.data.enabled && (
        <p className="text-muted-foreground text-sm">
          {m['guest_posts.closed']()}
        </p>
      )}

      <Card>
        <CardContent>
          <DataTable
            columns={columns}
            data={listQuery.data?.items ?? []}
            total={listQuery.data?.total ?? 0}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            rowKey={(r) => r.id}
            emptyText={m['guest_posts.empty']()}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={m['guest_posts.search_placeholder']()}
            toolbar={
              <Select
                value={status}
                onValueChange={(value) => setStatus(value || 'all')}
              >
                <SelectTrigger className="h-9 w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {m['guest_posts.status_all']()}
                  </SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tDynamic(`guest_posts.status_${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            onRefresh={() => listQuery.refetch()}
            loading={listQuery.isFetching || listQuery.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/settings/guest-posts/')({
  component: GuestPostsPage,
});
