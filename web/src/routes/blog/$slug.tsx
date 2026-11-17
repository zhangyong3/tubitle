import { createFileRoute, notFound } from '@tanstack/react-router';
import { describeSubmitProblem } from '@/routes/settings/guest-posts/-shared';
import { MDXProvider } from '@mdx-js/react';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Eye,
  Pencil,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { Link, useRouter } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { getLocale, localizeUrl } from '@/paraglide/runtime.js';
import { useGuestPostCheckout } from '@/hooks/use-guest-post-checkout';
import { formatPrice, guestPostSubmitProblem } from '@/hooks/use-guest-posts';
import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';
import { MarkdownContent } from '@/components/markdown-content';
import { mdxComponents } from '@/components/mdx-components';
import { PaymentProviderModal } from '@/components/payment-provider-modal';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  formatPostDate,
  loadLocalPost,
  type BlogPostDetail,
} from '@/content/posts';
import { getBlogPostFn, getBlogPreviewFn } from '@/content/posts/server';

export const Route = createFileRoute('/blog/$slug')({
  // ?preview=1: an unpublished guest post, for its author or a reviewer.
  validateSearch: (search: Record<string, unknown>): { preview?: boolean } =>
    search.preview === 1 || search.preview === '1' || search.preview === true
      ? { preview: true }
      : {},
  loaderDeps: ({ search }) => ({ preview: !!search.preview }),
  loader: async ({ params, deps }) => {
    const locale = getLocale();
    const post =
      (deps.preview
        ? await getBlogPreviewFn({ data: { slug: params.slug } })
        : null) ??
      (await getBlogPostFn({ data: { slug: params.slug, locale } }));
    if (!post) throw notFound();
    return { locale, post };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { locale, post } = loaderData;
    if (post.preview) {
      return {
        meta: [
          { title: `${post.title} | ${envConfigs.app_name}` },
          { name: 'robots', content: 'noindex, nofollow' },
        ],
      };
    }
    const canonical = localizeUrl(`${envConfigs.app_url}/blog/${post.slug}`, {
      locale: locale as any,
    }).href;
    return {
      meta: [
        { title: `${post.title} | ${envConfigs.app_name}` },
        { name: 'description', content: post.description },
      ],
      links: [{ rel: 'canonical', href: canonical }],
    };
  },
  component: BlogPostPage,
});

/**
 * Preview of an unpublished guest post. The author gets their next step
 * (pay to submit, or edit when changes were requested); reviewers a note.
 */
function PreviewBanner({
  info,
  title,
  content,
}: {
  info?: NonNullable<BlogPostDetail['previewInfo']>;
  title: string;
  content: string;
}) {
  const router = useRouter();
  const editHref = info ? `/settings/guest-posts/${info.guestPostId}` : '';
  const price = info ? formatPrice(info.priceInCents, info.currency) : '';
  // Straight to the payment page; if the article can't be submitted yet
  // (too short, too many links), offer the editor.
  const checkout = useGuestPostCheckout({
    resolveId: async () => info!.guestPostId,
    onError: (e) =>
      toast.error(e.message, {
        action: {
          label: m['blog.preview_edit'](),
          onClick: () => router.push(editHref),
        },
      }),
  });
  let text = m['blog.preview_banner']();
  let action: React.ReactNode = null;
  if (info?.isAuthor) {
    if (info.status === 'draft') {
      text = m['blog.preview_draft']();
      action = (
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={editHref}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'gap-1.5'
            )}
          >
            <Pencil className="size-3.5" />
            {m['blog.preview_edit']()}
          </Link>
          <Button
            size="sm"
            className="shrink-0 gap-1.5"
            disabled={checkout.pending}
            onClick={() => {
              const problem = guestPostSubmitProblem({
                title,
                content,
                minWords: info.minWords,
                maxLinks: info.maxLinks,
              });
              if (!problem) return checkout.pay();
              toast.error(describeSubmitProblem(problem), {
                action: {
                  label: m['blog.preview_edit'](),
                  onClick: () => router.push(editHref),
                },
              });
            }}
          >
            <Zap className="size-3.5" />
            {m['guest_posts.pay_submit']({ price })}
          </Button>
        </div>
      );
    } else if (info.status === 'changes_requested') {
      text = m['guest_posts.changes_hint']();
      action = (
        <Link
          href={editHref}
          className={cn(buttonVariants({ size: 'sm' }), 'shrink-0')}
        >
          {m['blog.preview_edit']()}
        </Link>
      );
    } else if (info.status === 'submitted') {
      text = m['blog.preview_submitted']();
    } else if (info.status === 'rejected') {
      text = m['guest_posts.rejected_hint']();
    } else if (info.status === 'unpublished') {
      text = m['guest_posts.unpublished_hint']();
    }
  }
  // Nothing to do here: a way back (the author's list, or the review dialog).
  if (info && !action) {
    action = (
      <Link
        href={
          info.isAuthor
            ? '/settings/guest-posts'
            : `/admin/guest-posts?id=${info.guestPostId}`
        }
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'shrink-0 gap-1.5'
        )}
      >
        {info.isAuthor
          ? m['blog.preview_my_posts']()
          : m['blog.preview_back_review']()}
        <ArrowRight className="size-3.5" />
      </Link>
    );
  }
  return (
    <div className="mx-auto mb-8 flex max-w-3xl flex-wrap items-center gap-3 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <Eye className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      {action}
      <PaymentProviderModal {...checkout.pickerProps} price={price} />
    </div>
  );
}

function siteHost() {
  try {
    return new URL(envConfigs.app_url).hostname;
  } catch {
    return envConfigs.app_name;
  }
}

function BlogPostPage() {
  const { locale, post } = Route.useLoaderData();

  // Local posts render their bundled MDX component; database posts render
  // raw markdown through MarkdownContent.
  const LocalContent =
    post.source === 'local' ? loadLocalPost(post.slug, locale)?.default : null;

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 px-6 py-12 md:px-8 md:py-16">
        {post.preview && (
          <PreviewBanner
            info={post.previewInfo}
            title={post.title}
            content={post.content || ''}
          />
        )}
        <article className="mx-auto max-w-3xl">
          <Link
            href="/blog"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm font-medium transition-colors"
          >
            <ArrowLeft className="size-4" />
            {m['blog.back_to_blog']()}
          </Link>

          <header className="border-border mt-8 mb-6 border-b pb-6">
            {post.sponsored && (
              <span className="text-muted-foreground border-border mb-3 inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide uppercase">
                {m['blog.sponsored']()}
              </span>
            )}
            <h1 className="text-foreground text-3xl font-semibold tracking-tight md:text-4xl">
              {post.title}
            </h1>
            <div className="text-muted-foreground mt-4 flex items-center gap-4 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="size-4" />
                {formatPostDate(post.createdAt, locale)}
              </span>
              {(post.authorName || post.authorImage) && (
                <span className="inline-flex items-center gap-2">
                  {post.authorImage && (
                    <img
                      src={post.authorImage}
                      alt={post.authorName || ''}
                      width={20}
                      height={20}
                      className="size-5 rounded-full object-cover"
                    />
                  )}
                  {post.authorName}
                </span>
              )}
            </div>
          </header>

          {post.description && (
            <p className="text-muted-foreground mb-6">{post.description}</p>
          )}

          {post.image && (
            <img
              src={post.image}
              alt={post.title}
              className="border-border mb-8 w-full rounded-2xl border object-cover"
            />
          )}

          {LocalContent ? (
            <div className="text-foreground/90 text-[15px] leading-7">
              <MDXProvider components={mdxComponents}>
                <LocalContent />
              </MDXProvider>
            </div>
          ) : (
            <MarkdownContent
              content={post.content || ''}
              sponsored={post.sponsored}
              // Guest posts: show the linked sites where their traffic
              // came from (utm_source = this site).
              utm={
                post.sponsored
                  ? { source: siteHost(), medium: 'guest_post' }
                  : undefined
              }
            />
          )}
        </article>
      </main>
      <Footer />
    </div>
  );
}
