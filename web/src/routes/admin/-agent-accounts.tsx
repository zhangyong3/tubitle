import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  type PageResult,
} from '@/lib/api-client';
import { formatDateTime } from '@/lib/time';
import { m } from '@/paraglide/messages.js';
import { useConfirm } from '@/hooks/use-confirm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { CopyButton } from './-copy-button';

interface AgentKey {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}
interface Agent {
  id: string;
  name: string;
  createdAt: string;
  roles: { id: string; name: string; title: string }[];
  keys: AgentKey[];
}
interface Role {
  id: string;
  name: string;
  title: string;
  description?: string | null;
}

const EXPIRY_DAYS = ['7', '30', '90', '365', 'never'] as const;
const AGENTS_KEY = ['admin-agent-accounts'];

function expiryLabel(d: string) {
  return d === 'never'
    ? m['admin.agent.never_expires']()
    : m['admin.agent.days']({ count: d });
}

function keyState(k: AgentKey): 'active' | 'expired' | 'revoked' {
  if (k.status !== 'active') return 'revoked';
  if (k.expiresAt && new Date(k.expiresAt) <= new Date()) return 'expired';
  return 'active';
}

/**
 * Agent service accounts: each is an `api`-type user whose permissions are
 * its RBAC roles, holding one or more admin API keys.
 */
export function AgentAccounts({ onConnect }: { onConnect?: () => void }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: AGENTS_KEY });
  const { confirm, dialog } = useConfirm();

  const agentsQuery = useQuery({
    queryKey: AGENTS_KEY,
    queryFn: () => apiGet<Agent[]>('/api/admin/agent/accounts'),
  });
  const rolesQuery = useQuery({
    queryKey: ['admin-agent-roles'],
    queryFn: () => apiGet<PageResult<Role>>('/api/admin/roles?pageSize=100'),
  });
  const agents = agentsQuery.data ?? [];
  const roles = rolesQuery.data?.items ?? [];

  // Create / edit agent
  const [editing, setEditing] = useState<Agent | 'new' | null>(null);
  const [name, setName] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  function openEditor(agent: Agent | 'new') {
    setEditing(agent);
    setName(agent === 'new' ? '' : agent.name);
    setRoleIds(agent === 'new' ? [] : agent.roles.map((r) => r.id));
  }
  const saveMutation = useMutation({
    // Resolves to the new agent's id on create, null on edit.
    mutationFn: async (): Promise<string | null> => {
      if (editing === 'new') {
        const created = await apiPost<{ id: string }>(
          '/api/admin/agent/accounts',
          { name: name.trim(), roleIds }
        );
        return created.id;
      }
      await apiPatch('/api/admin/agent/accounts', {
        id: (editing as Agent).id,
        name: name.trim(),
        roleIds,
      });
      return null;
    },
    onSuccess: (newId) => {
      setEditing(null);
      refresh();
      toast.success(m['admin.agent.saved']());
      // A new agent is useless without a key — go straight to issuing one.
      if (newId) setKeysFor(newId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Delete agent
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiDelete(`/api/admin/agent/accounts?id=${encodeURIComponent(id)}`),
    onSuccess: () => {
      setDeleting(null);
      refresh();
      toast.success(m['admin.agent.deleted']());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Keys dialog
  const [keysFor, setKeysFor] = useState<string | null>(null);
  const keysAgent = agents.find((a) => a.id === keysFor) ?? null;
  const [keyName, setKeyName] = useState('');
  const [expiryDays, setExpiryDays] = useState<string>('30');
  const [createdKey, setCreatedKey] = useState('');
  const createKeyMutation = useMutation({
    mutationFn: () =>
      apiPost<{ token: string }>('/api/admin/agent/keys', {
        agentId: keysFor,
        name: keyName.trim() || 'default',
        expiresAt:
          expiryDays === 'never'
            ? null
            : new Date(
                Date.now() + Number(expiryDays) * 86400000
              ).toISOString(),
      }),
    onSuccess: (data) => {
      setCreatedKey(data.token);
      setKeyName('');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      apiDelete(`/api/admin/agent/keys?id=${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success(m['admin.agent.revoked']());
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  function closeKeys() {
    setKeysFor(null);
    setCreatedKey('');
    setExpiryDays('30');
  }

  return (
    <Card>
      {dialog}
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0 flex-1 space-y-1.5">
          <CardTitle className="text-base">
            {m['admin.agent.accounts']()}
          </CardTitle>
          <CardDescription>
            {m['admin.agent.accounts_hint']()}{' '}
            <Link
              href="/admin/roles"
              className="text-primary underline-offset-4 hover:underline"
            >
              {m['admin.agent.manage_roles']()}
            </Link>
          </CardDescription>
        </div>
        <Button
          size="sm"
          className="shrink-0"
          onClick={() => openEditor('new')}
        >
          <Plus className="size-4" />
          {m['admin.agent.create_agent']()}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{m['admin.agent.agent_name']()}</TableHead>
                <TableHead>{m['admin.agent.agent_roles']()}</TableHead>
                <TableHead>{m['admin.agent.agent_keys']()}</TableHead>
                <TableHead>{m['admin.agent.agent_last_used']()}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => {
                const active = agent.keys.filter(
                  (k) => keyState(k) === 'active'
                );
                const lastUsed = agent.keys
                  .map((k) => k.lastUsedAt)
                  .filter(Boolean)
                  .sort()
                  .pop();
                return (
                  <TableRow key={agent.id}>
                    <TableCell className="font-medium">{agent.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {agent.roles.length ? (
                          agent.roles.map((r) => (
                            <Badge key={r.id} variant="secondary">
                              {r.title || r.name}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            {m['admin.agent.no_roles']()}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {m['admin.agent.active_keys']({ count: active.length })}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {lastUsed ? formatDateTime(lastUsed) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setKeysFor(agent.id)}
                        >
                          <KeyRound className="size-3.5" />
                          {m['admin.agent.keys']()}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={m['admin.agent.edit']()}
                          onClick={() => openEditor(agent)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={m['admin.agent.delete']()}
                          onClick={() => setDeleting(agent)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {agentsQuery.data?.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-muted-foreground h-20 text-center"
                  >
                    {m['admin.agent.no_agents']()}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* Create / edit agent */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing === 'new'
                ? m['admin.agent.create_agent']()
                : m['admin.agent.edit_agent']()}
            </DialogTitle>
            <DialogDescription>
              {m['admin.agent.agent_form_hint']()}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) saveMutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="agent-name">
                {m['admin.agent.agent_name']()}
              </Label>
              <Input
                id="agent-name"
                value={name}
                maxLength={100}
                placeholder="Claude Code"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{m['admin.agent.agent_roles']()}</Label>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3">
                {roles.map((r) => (
                  <label
                    key={r.id}
                    className="flex cursor-pointer items-start gap-2 text-sm"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={roleIds.includes(r.id)}
                      onCheckedChange={(checked) =>
                        setRoleIds((prev) =>
                          checked
                            ? [...prev, r.id]
                            : prev.filter((id) => id !== r.id)
                        )
                      }
                    />
                    <span>
                      <span className="font-medium">{r.title || r.name}</span>{' '}
                      <code className="text-muted-foreground text-xs">
                        {r.name}
                      </code>
                      {r.description && (
                        <span className="text-muted-foreground block text-xs">
                          {r.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={!name.trim() || saveMutation.isPending}
              >
                {m['admin.agent.save']()}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Keys of one agent */}
      <Dialog open={!!keysFor} onOpenChange={(v) => !v && closeKeys()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {m['admin.agent.keys_of']({ name: keysAgent?.name ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {m['admin.agent.keys_hint']()}
            </DialogDescription>
          </DialogHeader>

          {createdKey ? (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {m['admin.agent.created_warning']()}
              </p>
              <div className="bg-background flex items-center rounded-md pl-3">
                <code className="min-w-0 flex-1 py-2 text-xs break-all">
                  {createdKey}
                </code>
                <CopyButton value={createdKey} />
              </div>
              {onConnect && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    closeKeys();
                    onConnect();
                  }}
                >
                  {m['admin.agent.next_connect']()}
                </Button>
              )}
            </div>
          ) : (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                createKeyMutation.mutate();
              }}
            >
              {/* flex gap, not space-y: Base UI's Select appends a hidden
                  input, and space-y would push a margin under the trigger. */}
              <div className="flex min-w-40 flex-1 flex-col gap-1.5">
                <Label htmlFor="key-name">{m['admin.agent.key_name']()}</Label>
                <Input
                  id="key-name"
                  value={keyName}
                  maxLength={100}
                  placeholder="default"
                  onChange={(e) => setKeyName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{m['admin.agent.token_expires']()}</Label>
                <Select
                  items={EXPIRY_DAYS.map((d) => ({
                    value: d,
                    label: expiryLabel(d),
                  }))}
                  value={expiryDays}
                  onValueChange={(v) => v && setExpiryDays(String(v))}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_DAYS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {expiryLabel(d)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={createKeyMutation.isPending}>
                <Plus className="size-4" />
                {m['admin.agent.issue_key']()}
              </Button>
              {expiryDays === 'never' && (
                <p className="w-full rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  {m['admin.agent.never_warning']()}
                </p>
              )}
            </form>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{m['admin.agent.key_name']()}</TableHead>
                  <TableHead>{m['admin.agent.token_prefix']()}</TableHead>
                  <TableHead>{m['admin.agent.token_expires']()}</TableHead>
                  <TableHead>{m['admin.agent.token_last_used']()}</TableHead>
                  <TableHead>{m['admin.agent.token_status']()}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(keysAgent?.keys ?? []).map((k) => {
                  const state = keyState(k);
                  return (
                    <TableRow key={k.id}>
                      <TableCell>{k.name}</TableCell>
                      <TableCell>
                        <code className="text-xs">{k.keyPrefix}…</code>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {k.expiresAt
                          ? formatDateTime(k.expiresAt)
                          : m['admin.agent.never_expires']()}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={state === 'active' ? 'default' : 'secondary'}
                        >
                          {state === 'active'
                            ? m['admin.agent.status_active']()
                            : state === 'expired'
                              ? m['admin.agent.status_expired']()
                              : m['admin.agent.status_revoked']()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {state === 'active' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={revokeMutation.isPending}
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: m['admin.agent.revoke'](),
                                  description:
                                    m['admin.agent.revoke_warning'](),
                                  confirmLabel: m['admin.agent.revoke'](),
                                  destructive: true,
                                })
                              )
                                revokeMutation.mutate(k.id);
                            }}
                          >
                            {m['admin.agent.revoke']()}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {keysAgent && keysAgent.keys.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-muted-foreground h-16 text-center"
                    >
                      {m['admin.agent.no_tokens']()}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeKeys}>
              {m['admin.agent.done']()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete agent */}
      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {m['admin.agent.delete_title']({ name: deleting?.name ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {m['admin.agent.delete_warning']()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {m['admin.agent.cancel']()}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
            >
              {m['admin.agent.delete']()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
