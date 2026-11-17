import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ArrowLeft, ExternalLink, Eye, Info, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Link, useRouter } from '@/core/i18n/navigation';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { localizeHref } from '@/paraglide/runtime.js';
import { useGuestPostCheckout } from '@/hooks/use-guest-post-checkout';
import {
  countExternalLinks,
  countWords,
  formatPrice,
  guestPostSubmitProblem,
  useGuestPostInfo,
  type GuestPostPackage,
  type GuestPostStatus,
} from '@/hooks/use-guest-posts';
import {
  ImageUploader,
  type ImageUploaderValue,
} from '@/components/image-uploader';
import { MarkdownContent } from '@/components/markdown-content';
import { PaymentProviderModal } from '@/components/payment-provider-modal';
import { RichTextEditor } from '@/components/rich-text-editor';
import { SlugInput } from '@/components/slug-input';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { describeSubmitProblem, GuestPostStatusBadge } from './-shared';

interface Detail {
  submission: {
    id: string;
    productId: string;
    status: GuestPostStatus;
    reviewNote: string | null;
  };
  post: {
    slug: string;
    title: string | null;
    description: string | null;
    image: string | null;
    content: string | null;
  };
}

function GuestPostEditorPage() {
  const { id } = Route.useParams();
  // Package picked on /guest-post, preselected for a new article.
  const { package: requestedPackage } = Route.useSearch();
  const isNew = id === 'new';
  const router = useRouter();
  const queryClient = useQueryClient();
  const info = useGuestPostInfo();

  const detail = useQuery({
    queryKey: ['guest-post', id],
    queryFn: () => apiGet<Detail>(`/api/guest-posts/${id}`),
    enabled: !isNew,
  });

  const [productId, setProductId] = useState('');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [content, setContent] = useState('');
  const [loaded, setLoaded] = useState(isNew);

  // Fill the form once from the server copy.
  useEffect(() => {
    if (!detail.data || loaded) return;
    const { submission, post } = detail.data;
    setProductId(submission.productId);
    setTitle(post.title || '');
    setSlug(post.slug || '');
    setDescription(post.description || '');
    setImage(post.image || '');
    setContent(post.content || '');
    setLoaded(true);
  }, [detail.data, loaded]);

  const packages = info.data?.packages ?? [];
  useEffect(() => {
    if (productId || !packages.length) return;
    const requested = packages.find((p) => p.productId === requestedPackage);
    setProductId((requested ?? packages[0]).productId);
  }, [packages, productId, requestedPackage]);
  const pkg = packages.find((p) => p.productId === productId);
  const price = pkg ? formatPrice(pkg.priceInCents, pkg.currency) : '';

  const submission = detail.data?.submission;
  const status: GuestPostStatus = submission?.status ?? 'draft';
  const isDraft = isNew || status === 'draft';
  const editable = isDraft || status === 'changes_requested';

  const words = useMemo(() => countWords(content), [content]);
  const links = useMemo(() => countExternalLinks(content), [content]);
  const minWords = info.data?.minWords ?? 0;

  const refresh = (savedId: string) => {
    queryClient.invalidateQueries({ queryKey: ['guest-posts'] });
    queryClient.invalidateQueries({ queryKey: ['guest-post', savedId] });
  };

  /** Save the form; returns the submission id (creates it when new). */
  async function saveForm(resubmit = false) {
    const body = {
      productId,
      title,
      slug,
      description,
      image,
      content,
      resubmit,
    };
    if (isNew) {
      const res = await apiPost<{ id: string }>('/api/guest-posts', body);
      return res.id;
    }
    await apiPut(`/api/guest-posts/${id}`, body);
    return id;
  }

  const save = useMutation({
    mutationFn: (resubmit: boolean) => saveForm(resubmit),
    onSuccess: (savedId, resubmit) => {
      toast.success(
        resubmit
          ? m['guest_posts.resubmitted_toast']()
          : m['guest_posts.saved_toast']()
      );
      refresh(savedId);
      // Saved (or resubmitted): back to the list.
      router.replace('/settings/guest-posts');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const remove = useMutation({
    mutationFn: () => apiDelete(`/api/guest-posts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guest-posts'] });
      router.replace('/settings/guest-posts');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Submit = save, then pay (the webhook moves the paid draft into review).
  // A new article is saved first; if checkout then fails, open that draft so
  // a retry doesn't create a second one.
  const createdId = useRef<string | null>(null);
  const checkout = useGuestPostCheckout({
    resolveId: async () => {
      const savedId = createdId.current ?? (await saveForm(false));
      if (isNew) {
        createdId.current = savedId;
        refresh(savedId);
      }
      return savedId;
    },
    onError: (e) => {
      toast.error(e.message);
      if (isNew && createdId.current)
        router.replace(`/settings/guest-posts/${createdId.current}`);
    },
  });

  if (!isNew && (detail.isPending || !loaded)) {
    return (
      <div className="text-muted-foreground p-6">
        {m['guest_posts.loading']()}
      </div>
    );
  }
  if (!isNew && detail.isError) {
    return (
      <div className="text-muted-foreground p-6">{detail.error.message}</div>
    );
  }

  const busy = save.isPending || checkout.pending || remove.isPending;

  /** Check first (a failed submit saves nothing), then save and pay. */
  function submitAndPay() {
    const problem = guestPostSubmitProblem({
      title,
      content,
      minWords,
      maxLinks: pkg?.maxLinks ?? 0,
    });
    if (problem) toast.error(describeSubmitProblem(problem));
    else checkout.pay();
  }
  // The saved slug (previews and links use it, not the field being edited).
  const savedSlug = detail.data?.post.slug;

  return (
    <div className="space-y-6 p-6 lg:max-w-4xl">
      <div className="space-y-3">
        <Link
          href="/settings/guest-posts"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          {m['guest_posts.back']()}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">
            {isNew
              ? m['guest_posts.new_title']()
              : m['guest_posts.edit_title']()}
          </h1>
          {!isNew && <GuestPostStatusBadge status={status} />}
          <div className="ml-auto flex items-center gap-2">
            {isDraft && pkg && (
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={busy}
                onClick={submitAndPay}
              >
                <Zap className="size-3.5" />
                {m['guest_posts.pay_submit']({ price })}
              </Button>
            )}
            {!isNew && savedSlug && status !== 'published' && (
              <a
                href={localizeHref(`/blog/${savedSlug}?preview=1`)}
                target="_blank"
                rel="noopener"
                title={
                  editable ? m['guest_posts.preview_saved_hint']() : undefined
                }
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'gap-1.5'
                )}
              >
                <Eye className="size-3.5" />
                {m['guest_posts.preview']()}
              </a>
            )}
            {/* Only unpaid drafts can be deleted. */}
            {!isNew && status === 'draft' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive gap-1.5"
                disabled={busy}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-3.5" />
                {m['guest_posts.delete']()}
              </Button>
            )}
          </div>
        </div>
      </div>

      {!isNew && (
        <StatusPanel
          status={status}
          note={submission?.reviewNote}
          slug={savedSlug}
        />
      )}

      {editable ? (
        <form
          className="min-w-0 space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (isDraft) submitAndPay();
            else save.mutate(true);
          }}
        >
          <div className="space-y-2">
            <Label>{m['guest_posts.package']()}</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              {(isDraft ? packages : packages.filter((p) => p === pkg)).map(
                (p) => (
                  <PackageOption
                    key={p.productId}
                    pkg={p}
                    selected={p.productId === productId}
                    disabled={!isDraft}
                    onSelect={() => setProductId(p.productId)}
                  />
                )
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gp-title">{m['guest_posts.field_title']()}</Label>
            <Input
              id="gp-title"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gp-slug">{m['guest_posts.field_slug']()}</Label>
            <SlugInput
              id="gp-slug"
              prefix="/blog/"
              value={slug}
              placeholder={m['guest_posts.slug_placeholder']()}
              onChange={setSlug}
            />
            <p className="text-muted-foreground text-xs">
              {m['guest_posts.slug_hint']()}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gp-summary">
              {m['guest_posts.field_summary']()}
            </Label>
            <Textarea
              id="gp-summary"
              value={description}
              maxLength={500}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{m['guest_posts.field_cover']()}</Label>
            <ImageUploader
              maxSizeMB={5}
              defaultPreviews={image ? [image] : undefined}
              onChange={(items: ImageUploaderValue[]) => {
                const done = items.find(
                  (i) => i.status === 'uploaded' && i.url
                );
                setImage(done?.url || (items.length ? image : ''));
              }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Label>{m['guest_posts.field_content']()}</Label>
              <span className="text-muted-foreground text-xs">
                <span className={cn(words < minWords && 'text-destructive')}>
                  {m['guest_posts.word_count']({
                    count: words,
                    min: minWords,
                  })}
                </span>
                {' · '}
                <span
                  className={cn(
                    pkg && links > pkg.maxLinks && 'text-destructive'
                  )}
                >
                  {m['guest_posts.link_count']({
                    count: links,
                    max: pkg?.maxLinks ?? 0,
                  })}
                </span>
              </span>
            </div>
            <RichTextEditor
              value={content}
              onChange={setContent}
              placeholder={m['guest_posts.content_placeholder']()}
            />
            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {m['guest_posts.sponsored_notice']()}{' '}
                {/* New tab, so the article being edited isn't lost. */}
                <a
                  href={localizeHref('/guest-post')}
                  target="_blank"
                  rel="noopener"
                  className="text-primary font-medium underline-offset-4 hover:underline"
                >
                  {m['guest_posts.guidelines_link']()}
                </a>
              </span>
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !pkg}>
                {isDraft
                  ? m['guest_posts.pay_submit']({ price })
                  : m['guest_posts.resubmit']()}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || !pkg}
                onClick={() => save.mutate(false)}
              >
                {m['guest_posts.save_draft']()}
              </Button>
            </div>
            {isDraft && (
              <p className="text-muted-foreground text-xs">
                {m['guest_posts.pay_notice']()}
              </p>
            )}
          </div>
        </form>
      ) : (
        <Card>
          <CardContent className="space-y-4">
            <h2 className="text-xl font-semibold">{title}</h2>
            {description && (
              <p className="text-muted-foreground">{description}</p>
            )}
            {image && <img src={image} alt="" className="rounded-xl border" />}
            <MarkdownContent content={content} sponsored />
          </CardContent>
        </Card>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m['guest_posts.delete_title']()}</DialogTitle>
            <DialogDescription>
              {m['guest_posts.delete_confirm']({ title: title || '—' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {m['guest_posts.cancel']()}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {m['guest_posts.delete']()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PaymentProviderModal
        {...checkout.pickerProps}
        planName={pkg?.planName}
        price={price}
      />
    </div>
  );
}

function PackageOption({
  pkg,
  selected,
  disabled,
  onSelect,
}: {
  pkg: GuestPostPackage;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'rounded-xl border p-4 text-left transition-colors disabled:cursor-default',
        selected ? 'border-primary bg-accent' : 'hover:bg-muted/50'
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{pkg.planName}</span>
        <span className="font-semibold">
          {formatPrice(pkg.priceInCents, pkg.currency)}
        </span>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        {m['guest_posts.package_links']({ count: pkg.maxLinks })}
      </p>
    </button>
  );
}

function StatusPanel({
  status,
  note,
  slug,
}: {
  status: GuestPostStatus;
  note?: string | null;
  slug?: string;
}) {
  let body: React.ReactNode = null;
  if (status === 'submitted') {
    body = <p className="text-sm">{m['guest_posts.submitted_hint']()}</p>;
  } else if (status === 'changes_requested') {
    body = <p className="text-sm">{m['guest_posts.changes_hint']()}</p>;
  } else if (status === 'rejected') {
    body = <p className="text-sm">{m['guest_posts.rejected_hint']()}</p>;
  } else if (status === 'published' && slug) {
    body = (
      <a
        href={localizeHref(`/blog/${slug}`)}
        target="_blank"
        rel="noopener"
        className="text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
      >
        {m['guest_posts.view_article']()}
        <ExternalLink className="size-3.5" />
      </a>
    );
  } else if (status === 'unpublished') {
    body = <p className="text-sm">{m['guest_posts.unpublished_hint']()}</p>;
  }
  // A reviewer's note only matters while it explains the current state; an
  // earlier "please change…" shouldn't linger once the author resubmits.
  if (!['changes_requested', 'rejected', 'unpublished'].includes(status)) {
    note = null;
  }
  if (!body && !note) return null;
  return (
    <Card>
      <CardContent className="space-y-3">
        {body}
        {note && (
          <div className="bg-muted rounded-lg p-3 text-sm">
            <p className="font-medium">{m['guest_posts.review_note']()}</p>
            <p className="text-muted-foreground mt-1 whitespace-pre-line">
              {note}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const Route = createFileRoute('/settings/guest-posts/$id')({
  validateSearch: (search: Record<string, unknown>): { package?: string } =>
    typeof search.package === 'string' && search.package
      ? { package: search.package }
      : {},
  component: GuestPostEditorPage,
});
