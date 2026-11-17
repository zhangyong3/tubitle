import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';

import { envConfigs } from '@/config';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { AgentAccounts } from './-agent-accounts';
import { AgentLogs } from './-agent-logs';
import { CopyButton } from './-copy-button';

/** `wrap` for prose (a prompt) rather than code, so long lines stay visible. */
function CodeBlock({ code, wrap }: { code: string; wrap?: boolean }) {
  return (
    <div className="bg-muted relative rounded-lg">
      <pre
        className={cn(
          'overflow-x-auto p-4 pr-12 font-mono text-xs leading-relaxed',
          wrap && 'break-words whitespace-pre-wrap'
        )}
      >
        {code}
      </pre>
      <CopyButton value={code} className="absolute top-2 right-2" />
    </div>
  );
}

function UrlRow({
  label,
  url,
  href,
}: {
  label: string;
  url: string;
  /** Set to show an "open" link (GET endpoints that accept the session). */
  href?: string;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="text-muted-foreground shrink-0 text-sm">{label}</span>
      <div className="bg-muted flex min-w-0 flex-1 items-center rounded-md pl-3">
        <code className="min-w-0 flex-1 truncate py-1.5 text-xs">{url}</code>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={m['admin.agent.open']()}
            className="text-muted-foreground hover:text-foreground flex size-7 items-center justify-center"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
        <CopyButton value={url} />
      </div>
    </div>
  );
}

const PAGE_TABS = ['accounts', 'connect', 'logs'] as const;
type PageTab = (typeof PAGE_TABS)[number];

/**
 * A stable, unique-per-site project name. App names can repeat across projects
 * (e.g. an untouched template), domains can't: "www.myshop.com" → "myshop-com".
 * Locally, the app name plus port, so side-by-side dev sites don't collide.
 */
function projectSlug(appName: string, origin: string) {
  const clean = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  try {
    const url = new URL(origin);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      return clean(url.hostname.replace(/^www\./, ''));
    const base = clean(appName) || 'shipany';
    return url.port ? `${base}-${url.port}` : base;
  } catch {
    return clean(appName) || 'shipany';
  }
}

function AgentPage() {
  const permissionsQuery = useUserPermissions();
  const isOwner = !!permissionsQuery.data?.isAdmin;
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Only full admins manage agents; everyone else just sees how to connect.
  const tab: PageTab = isOwner ? (search.tab ?? 'accounts') : 'connect';
  const setTab = (next: PageTab) =>
    navigate({
      search: { tab: next === 'accounts' ? undefined : next },
      replace: true,
    });

  // Initial render uses the configured URL so SSR and hydration agree; the
  // browser origin wins afterwards (it is what an agent must call).
  const [origin, setOrigin] = useState(envConfigs.app_url.replace(/\/$/, ''));
  useEffect(() => setOrigin(window.location.origin), []);

  const mcpUrl = `${origin}/api/admin/agent/mcp`;
  // One name per site, so several ShipAny projects can sit side by side in an
  // agent's skill store and MCP config without overwriting each other.
  const project = projectSlug(envConfigs.app_name, origin);
  const snippets = {
    claude: `claude mcp add --transport http ${project} ${mcpUrl} \\
  --header "Authorization: Bearer sa_admin_..."`,
    mcpJson: JSON.stringify(
      {
        mcpServers: {
          [project]: {
            type: 'http',
            url: mcpUrl,
            headers: { Authorization: 'Bearer sa_admin_...' },
          },
        },
      },
      null,
      2
    ),
    // A prompt to paste to the agent: it installs the skill from this site and
    // saves this project's URL + key (sent separately) under `project`.
    skill: m['admin.agent.skill_prompt']({
      app: envConfigs.app_name,
      url: origin,
      name: project,
    }),
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{m['admin.agent.title']()}</h1>
        <p className="text-muted-foreground">
          {m['admin.agent.description']()}
        </p>
      </div>

      {isOwner && (
        <div className="border-border flex gap-1 overflow-x-auto overflow-y-hidden border-b">
          {PAGE_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                '-mb-px border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                tab === t
                  ? 'border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground border-transparent'
              )}
            >
              {t === 'accounts'
                ? m['admin.agent.tab_accounts']()
                : t === 'connect'
                  ? m['admin.agent.tab_connect']()
                  : m['admin.agent.tab_logs']()}
            </button>
          ))}
        </div>
      )}

      {tab === 'accounts' && isOwner && (
        <AgentAccounts onConnect={() => setTab('connect')} />
      )}

      {tab === 'logs' && isOwner && <AgentLogs />}

      {tab === 'connect' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {m['admin.agent.quickstart']()}
            </CardTitle>
            <CardDescription>
              {m['admin.agent.quickstart_hint']()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* ui/tabs keys its column layout off data-horizontal, which Base UI
                doesn't set (it sets data-orientation) — force it here. */}
            <Tabs defaultValue="skill" className="flex-col">
              <TabsList>
                <TabsTrigger value="skill">Skill</TabsTrigger>
                <TabsTrigger value="mcp">MCP</TabsTrigger>
              </TabsList>
              <TabsContent value="skill" className="space-y-3 pt-3">
                <p className="text-muted-foreground text-sm">
                  {m['admin.agent.skill_hint']()}
                </p>
                <CodeBlock code={snippets.skill} wrap />
              </TabsContent>
              <TabsContent value="mcp" className="space-y-3 pt-3">
                <UrlRow label={m['admin.agent.mcp_url']()} url={mcpUrl} />
                <p className="text-muted-foreground text-sm">
                  {m['admin.agent.mcp_claude']()}
                </p>
                <CodeBlock code={snippets.claude} />
                <p className="text-muted-foreground text-sm">
                  {m['admin.agent.mcp_json']()}
                </p>
                <CodeBlock code={snippets.mcpJson} />
              </TabsContent>
            </Tabs>
            <p className="text-muted-foreground mt-4 text-xs">
              {m['admin.agent.full_docs']()}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/agent')({
  validateSearch: (search: Record<string, unknown>): { tab?: PageTab } =>
    search.tab === 'connect' || search.tab === 'logs'
      ? { tab: search.tab }
      : {},
  component: AgentPage,
});
