import { useEffect, useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ExternalLink, Eye } from 'lucide-react';
import { toast } from 'sonner';

import { tDynamic } from '@/core/i18n/dynamic';
import {
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  pageQuery,
  type PageResult,
} from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { localizeHref } from '@/paraglide/runtime.js';
import { useConfirm } from '@/hooks/use-confirm';
import {
  countExternalLinks,
  countWords,
  formatDate,
  formatPrice,
  packageLabel,
  useGuestPostInfo,
  type GuestPostRow,
  type GuestPostStatus,
} from '@/hooks/use-guest-posts';
import { DataTable, type Column } from '@/components/data-table';
import { MarkdownContent } from '@/components/markdown-content';
import { RichTextEditor } from '@/components/rich-text-editor';
import { SlugInput } from '@/components/slug-input';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { UserCell } from '@/components/user-cell';

import {
  ArticleUrl,
  GuestPostStatusBadge,
  PackageCell,
  ReviewNoteCell,
} from '../settings/guest-posts/-shared';

const PAGE_SIZE = 20;
// "All" leads, like the other admin tabs.
const TABS = [
  'all',
  'submitted',
  'published',
  'changes_requested',
  'rejected',
  'unpublished',
] as const;
type Tab = (typeof TABS)[number];

interface AdminDetail {
  submission: GuestPostRow & { status: GuestPostStatus; userId: string };
  post: {
    slug: string;
    title: string | null;
    description: string | null;
    image: string | null;
    content: string | null;
  };
  userName: string | null;
  userEmail: string | null;
  userAvatar: string | null;
  orderStatus: string | null;
  package: {
    planName: string;
    maxLinks: number;
    priceInCents: number;
    currency: string;
  } | null;
}

function AdminGuestPostsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('all');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const info = useGuestPostInfo();

  // `?id=` opens that submission (deep links from bot notifications).
  const deepLinkId = Route.useSearch().id;
  useEffect(() => {
    if (deepLinkId) setOpenId(deepLinkId);
  }, [deepLinkId]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [debounced, tab]);

  const listQuery = useQuery({
    queryKey: ['admin-guest-posts', page, tab, debounced],
    queryFn: () =>
      apiGet<PageResult<GuestPostRow>>(
        pageQuery('/api/admin/guest-posts', {
          page,
          pageSize: PAGE_SIZE,
          search: debounced,
        }) + (tab === 'all' ? '' : `&status=${tab}`)
      ),
    placeholderData: keepPreviousData,
  });

  const columns: Column<GuestPostRow>[] = [
    {
      header: m['admin.guest_posts.title_col'](),
      cell: (r) => (
        <div className="min-w-0">
          <button
            className="text-left font-medium hover:underline"
            onClick={() => setOpenId(r.id)}
          >
            {r.title || '—'}
          </button>
          <ArticleUrl slug={r.slug} status={r.status} />
        </div>
      ),
    },
    {
      header: m['admin.guest_posts.author_col'](),
      cell: (r) =>
        r.userId ? (
          <UserCell
            userId={r.userId}
            name={r.userName}
            email={r.userEmail}
            image={r.userAvatar}
          />
        ) : (
          '—'
        ),
    },
    {
      header: m['guest_posts.package_col'](),
      className: 'w-[170px]',
      cell: (r) => (
        <PackageCell productId={r.productId} packages={info.data?.packages} />
      ),
    },
    {
      header: m['admin.guest_posts.status_col'](),
      className: 'w-[130px]',
      cell: (r) => <GuestPostStatusBadge status={r.status} />,
    },
    {
      header: m['guest_posts.review_note'](),
      className: 'min-w-[220px]',
      cell: (r) => <ReviewNoteCell status={r.status} note={r.reviewNote} />,
    },
    {
      header: m['admin.guest_posts.updated_col'](),
      className: 'w-[170px]',
      cell: (r) => (
        <span className="text-muted-foreground">{formatDate(r.updatedAt)}</span>
      ),
    },
    {
      header: m['admin.guest_posts.actions_col'](),
      className: 'w-[80px]',
      cell: (r) => (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title={m['admin.guest_posts.view']()}
          onClick={() => setOpenId(r.id)}
        >
          <Eye className="size-3" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{m['admin.guest_posts.title']()}</h1>
        <p className="text-muted-foreground">
          {m['admin.guest_posts.description']()}
        </p>
      </div>

      <div className="border-border flex gap-1 overflow-x-auto overflow-y-hidden border-b">
        {TABS.map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors',
              tab === tb
                ? 'border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            )}
          >
            {tb === 'all'
              ? m['admin.guest_posts.tab_all']()
              : tDynamic(`guest_posts.status_${tb}`)}
          </button>
        ))}
      </div>

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
            emptyText={m['admin.guest_posts.empty']()}
            search={search}
            onSearchChange={setSearch}
            onRefresh={() => listQuery.refetch()}
            loading={listQuery.isFetching || listQuery.isPending}
          />
        </CardContent>
      </Card>

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {openId && (
            <ReviewPanel
              id={openId}
              onChanged={() => {
                queryClient.invalidateQueries({
                  queryKey: ['admin-guest-posts'],
                });
                queryClient.invalidateQueries({
                  queryKey: ['admin-guest-post', openId],
                });
              }}
              onDone={() => setOpenId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Draft = {
  title: string;
  slug: string;
  description: string;
  image: string;
  content: string;
};

function toDraft(post: AdminDetail['post']): Draft {
  return {
    title: post.title || '',
    slug: post.slug || '',
    description: post.description || '',
    image: post.image || '',
    content: post.content || '',
  };
}

// One view: the article is always editable, and the review actions save
// pending edits first (approve) or ask before dropping them (the rest).
function ReviewPanel({
  id,
  onChanged,
  onDone,
}: {
  id: string;
  onChanged: () => void;
  onDone: () => void;
}) {
  const detail = useQuery({
    queryKey: ['admin-guest-post', id],
    queryFn: () => apiGet<AdminDetail>(`/api/admin/guest-posts/${id}`),
  });
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const { confirm, dialog } = useConfirm();

  // Seed the editor once the detail loads.
  const loadedPost = detail.data?.post;
  useEffect(() => {
    if (loadedPost && !draft) setDraft(toDraft(loadedPost));
  }, [loadedPost, draft]);

  const saved = loadedPost ? toDraft(loadedPost) : null;
  const dirty =
    !!draft &&
    !!saved &&
    (Object.keys(saved) as (keyof Draft)[]).some((k) => draft[k] !== saved[k]);

  const save = () => apiPut(`/api/admin/guest-posts/${id}`, draft);

  const review = useMutation({
    mutationFn: async (action: 'approve' | 'request_changes') => {
      // Publish what the reviewer sees, edits included.
      if (action === 'approve' && dirty) await save();
      return apiPost(`/api/admin/guest-posts/${id}`, { action, note });
    },
    onSuccess: () => {
      toast.success(m['admin.guest_posts.reviewed_toast']());
      onChanged();
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  // Refunds the order (dedicated permission); the refund marks it rejected.
  const reject = useMutation({
    mutationFn: () => apiPost(`/api/admin/guest-posts/${id}/reject`, { note }),
    onSuccess: () => {
      toast.success(m['admin.guest_posts.rejected_toast']());
      onChanged();
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const restore = useMutation({
    mutationFn: async (action: 'republish' | 'request_changes') => {
      // Put back what the reviewer sees, edits included.
      if (action === 'republish' && dirty) await save();
      return apiPost(`/api/admin/guest-posts/${id}/restore`, { action, note });
    },
    onSuccess: () => {
      toast.success(m['admin.guest_posts.reviewed_toast']());
      onChanged();
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const unpublish = useMutation({
    mutationFn: () => apiPatch(`/api/admin/guest-posts/${id}`, { note }),
    onSuccess: () => {
      toast.success(m['admin.guest_posts.unpublished_toast']());
      onChanged();
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveEdit = useMutation({
    mutationFn: save,
    onSuccess: async () => {
      toast.success(m['admin.guest_posts.saved_toast']());
      onChanged();
      // Re-seed from the saved row (the server normalizes the slug).
      await detail.refetch();
      setDraft(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (detail.isError) {
    return <p className="text-muted-foreground">{detail.error.message}</p>;
  }
  if (detail.isPending || !draft) {
    return <p className="text-muted-foreground">{m['admin.loading']()}</p>;
  }
  const { submission: s, post, package: pkg } = detail.data;
  const links = countExternalLinks(draft.content);
  const busy =
    review.isPending ||
    reject.isPending ||
    unpublish.isPending ||
    restore.isPending ||
    saveEdit.isPending;
  // Taken down but still paid for: it can come back. A refund also takes a
  // published post down, and that one stays down.
  const restorable =
    s.status === 'unpublished' && detail.data.orderStatus === 'paid';
  const slugChanged =
    s.status === 'published' && draft.slug.trim().toLowerCase() !== post.slug;
  // Actions that don't publish leave edits unsaved; confirm dropping them.
  const keepsEdits = async () =>
    !dirty ||
    confirm({
      title: m['admin.guest_posts.unsaved_title'](),
      description: m['admin.guest_posts.unsaved_discard'](),
      confirmLabel: m['admin.guest_posts.discard_continue'](),
      destructive: true,
    });

  return (
    <div className="space-y-5">
      {dialog}
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-3 pr-6">
          {post.title || '—'}
          <GuestPostStatusBadge status={s.status} />
        </DialogTitle>
      </DialogHeader>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <Meta label={m['admin.guest_posts.author_col']()}>
          <UserCell
            userId={s.userId}
            name={detail.data.userName}
            email={detail.data.userEmail}
            image={detail.data.userAvatar}
          />
        </Meta>
        <Meta label={m['admin.guest_posts.package']()}>
          {pkg
            ? `${pkg.planName} · ${formatPrice(pkg.priceInCents, pkg.currency)}`
            : s.productId}
        </Meta>
        <Meta label={m['admin.guest_posts.counts']()}>
          <span
            className={cn(pkg && links > pkg.maxLinks && 'text-destructive')}
          >
            {m['guest_posts.link_count']({
              count: links,
              max: pkg?.maxLinks ?? 0,
            })}
          </span>
          <span className="text-muted-foreground block text-xs">
            {m['admin.guest_posts.words']({
              count: countWords(draft.content),
            })}
          </span>
        </Meta>
        <Meta label={m['admin.guest_posts.submitted_at']()}>
          {formatDate(s.submittedAt)}
        </Meta>
        {s.orderNo && (
          <Meta label={m['admin.guest_posts.order']()}>
            <span className="font-mono text-xs">{s.orderNo}</span>
          </Meta>
        )}
      </dl>

      {s.status === 'published' && (
        <a
          href={localizeHref(`/blog/${post.slug}`)}
          target="_blank"
          rel="noopener"
          className="text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        >
          {m['guest_posts.view_article']()}
          <ExternalLink className="size-3.5" />
        </a>
      )}

      {s.reviewNote && (
        <div className="bg-muted rounded-lg p-3 text-sm">
          <p className="font-medium">{m['guest_posts.review_note']()}</p>
          <p className="text-muted-foreground mt-1 whitespace-pre-line">
            {s.reviewNote}
          </p>
        </div>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>{m['guest_posts.field_title']()}</Label>
          <Input
            value={draft.title}
            maxLength={200}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="gp-admin-slug">{m['guest_posts.field_slug']()}</Label>
          <SlugInput
            id="gp-admin-slug"
            prefix="/blog/"
            value={draft.slug}
            placeholder={m['guest_posts.slug_placeholder']()}
            onChange={(slug) => setDraft((d) => d && { ...d, slug })}
          />
          {slugChanged ? (
            <p className="text-destructive text-xs">
              {m['admin.guest_posts.slug_change_warning']()}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              {m['admin.guest_posts.slug_hint']()}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label>{m['guest_posts.field_summary']()}</Label>
          <Textarea
            value={draft.description}
            rows={2}
            maxLength={500}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </div>
        <div className="space-y-2">
          <Label>{m['guest_posts.field_content']()}</Label>
          <RichTextEditor
            value={draft.content}
            onChange={(c) => setDraft((d) => d && { ...d, content: c })}
          />
        </div>
        {dirty && (
          <div className="flex items-center gap-2">
            <Button
              disabled={busy}
              onClick={async () => {
                if (
                  slugChanged &&
                  !(await confirm({
                    title: m['admin.guest_posts.slug_change_title'](),
                    description: m['admin.guest_posts.slug_change_confirm'](),
                    destructive: true,
                  }))
                )
                  return;
                saveEdit.mutate();
              }}
            >
              {m['admin.guest_posts.save']()}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDraft(toDraft(post))}
            >
              {m['admin.guest_posts.discard']()}
            </Button>
            <span className="text-muted-foreground text-xs">
              {m['admin.guest_posts.unsaved']()}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t pt-4">
        {(['submitted', 'changes_requested', 'published'].includes(s.status) ||
          restorable) && (
          <div className="space-y-2">
            <Label htmlFor="gp-note">{m['admin.guest_posts.note']()}</Label>
            <Textarea
              id="gp-note"
              value={note}
              rows={2}
              maxLength={2000}
              placeholder={m['admin.guest_posts.note_placeholder']()}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {s.status === 'submitted' && (
            <>
              <Button disabled={busy} onClick={() => review.mutate('approve')}>
                {m['admin.guest_posts.approve']()}
              </Button>
              <Button
                variant="outline"
                disabled={busy || !note.trim()}
                onClick={async () => {
                  if (await keepsEdits()) review.mutate('request_changes');
                }}
              >
                {m['admin.guest_posts.request_changes']()}
              </Button>
            </>
          )}
          {(s.status === 'submitted' || s.status === 'changes_requested') && (
            <Button
              variant="outline"
              className="text-destructive"
              disabled={busy || !note.trim()}
              onClick={async () => {
                const price = pkg
                  ? formatPrice(pkg.priceInCents, pkg.currency)
                  : '';
                if (!(await keepsEdits())) return;
                if (
                  await confirm({
                    title: m['admin.guest_posts.reject'](),
                    description: m['admin.guest_posts.reject_confirm']({
                      price,
                    }),
                    confirmLabel: m['admin.guest_posts.reject'](),
                    destructive: true,
                  })
                )
                  reject.mutate();
              }}
            >
              {m['admin.guest_posts.reject']()}
            </Button>
          )}
          {s.status === 'published' && (
            <Button
              variant="outline"
              className="text-destructive"
              disabled={busy}
              onClick={async () => {
                if (!(await keepsEdits())) return;
                if (
                  await confirm({
                    title: m['admin.guest_posts.unpublish'](),
                    description: m['admin.guest_posts.unpublish_confirm'](),
                    confirmLabel: m['admin.guest_posts.unpublish'](),
                    destructive: true,
                  })
                )
                  unpublish.mutate();
              }}
            >
              {m['admin.guest_posts.unpublish']()}
            </Button>
          )}
          {restorable && (
            <>
              <Button
                disabled={busy}
                onClick={async () => {
                  if (
                    await confirm({
                      title: m['admin.guest_posts.republish'](),
                      description: m['admin.guest_posts.republish_confirm'](),
                      confirmLabel: m['admin.guest_posts.republish'](),
                    })
                  )
                    restore.mutate('republish');
                }}
              >
                {m['admin.guest_posts.republish']()}
              </Button>
              <Button
                variant="outline"
                disabled={busy || !note.trim()}
                onClick={async () => {
                  if (await keepsEdits()) restore.mutate('request_changes');
                }}
              >
                {m['admin.guest_posts.request_changes']()}
              </Button>
            </>
          )}
          {s.status !== 'published' && (
            // The preview renders the saved version, not pending edits.
            <a
              href={localizeHref(`/blog/${post.slug}?preview=1`)}
              target="_blank"
              rel="noopener"
              title={
                dirty ? m['admin.guest_posts.preview_unsaved']() : undefined
              }
              className={cn(
                buttonVariants({ variant: 'ghost' }),
                'ml-auto gap-1.5'
              )}
            >
              <Eye className="size-4" />
              {m['guest_posts.preview']()}
            </a>
          )}
        </div>
        {s.status === 'submitted' && (
          <p className="text-muted-foreground text-xs">
            {m['admin.guest_posts.review_hint']()}
          </p>
        )}
        {s.status === 'unpublished' && (
          <p className="text-muted-foreground text-xs">
            {restorable
              ? m['admin.guest_posts.restore_hint']()
              : m['admin.guest_posts.refunded_hint']()}
          </p>
        )}
      </div>
    </div>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

export const Route = createFileRoute('/admin/guest-posts')({
  validateSearch: (search: Record<string, unknown>): { id?: string } =>
    typeof search.id === 'string' && search.id ? { id: search.id } : {},
  component: AdminGuestPostsPage,
});
