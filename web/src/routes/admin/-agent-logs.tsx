import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { apiGet, type PageResult } from '@/lib/api-client';
import { formatDateTime } from '@/lib/time';
import { m } from '@/paraglide/messages.js';
import { DataTable, type Column } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Execution {
  id: string;
  userId: string;
  userName: string | null;
  tokenId: string | null;
  keyName: string | null;
  keyPrefix: string | null;
  operation: string;
  targetId: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

const PAGE_SIZE = 20;
const ALL = '__all__';

function duration(e: Execution) {
  if (!e.completedAt) return '—';
  const ms =
    new Date(e.completedAt).getTime() - new Date(e.createdAt).getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <Badge>{m['admin.agent.log_completed']()}</Badge>;
    case 'failed':
      return (
        <Badge variant="destructive">{m['admin.agent.log_failed']()}</Badge>
      );
    case 'pending':
      return (
        <Badge variant="secondary">{m['admin.agent.log_pending']()}</Badge>
      );
    default:
      // 'unknown': the call may have had side effects before a crash.
      return <Badge variant="outline">{m['admin.agent.log_unknown']()}</Badge>;
  }
}

/** Every call an agent made with its admin key, newest first. */
export function AgentLogs() {
  const [page, setPage] = useState(1);
  const [agentId, setAgentId] = useState<string>(ALL);

  // Same cache as the accounts tab — just names for the filter.
  const agentsQuery = useQuery({
    queryKey: ['admin-agent-accounts'],
    queryFn: () =>
      apiGet<{ id: string; name: string }[]>('/api/admin/agent/accounts'),
  });
  const agents = agentsQuery.data ?? [];

  const query = useQuery({
    queryKey: ['admin-agent-logs', page, agentId],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (agentId !== ALL) params.set('userId', agentId);
      return apiGet<PageResult<Execution>>(`/api/admin/agent/audit?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const columns: Column<Execution>[] = [
    {
      header: m['admin.agent.log_time'](),
      cell: (e) => (
        <span className="text-muted-foreground text-sm whitespace-nowrap">
          {formatDateTime(e.createdAt)}
        </span>
      ),
    },
    {
      header: m['admin.agent.log_agent'](),
      cell: (e) => (
        <div className="text-sm">
          <div className="font-medium">
            {e.userName ?? (
              <span className="text-muted-foreground">
                {m['admin.agent.log_deleted_agent']()}
              </span>
            )}
          </div>
          {e.keyName && (
            <div className="text-muted-foreground text-xs">
              {e.keyName}
              {e.keyPrefix && <code className="ml-1">{e.keyPrefix}…</code>}
            </div>
          )}
        </div>
      ),
    },
    {
      header: m['admin.agent.log_operation'](),
      cell: (e) => <code className="text-xs">{e.operation}</code>,
    },
    {
      header: m['admin.agent.log_target'](),
      cell: (e) =>
        e.targetId ? (
          <code className="text-muted-foreground text-xs">{e.targetId}</code>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      header: m['admin.agent.log_status'](),
      cell: (e) => <StatusBadge status={e.status} />,
    },
    {
      header: m['admin.agent.log_duration'](),
      cell: (e) => (
        <span className="text-muted-foreground text-sm tabular-nums">
          {duration(e)}
        </span>
      ),
    },
  ];

  const agentItems = [
    { value: ALL, label: m['admin.agent.log_all_agents']() },
    ...agents.map((a) => ({ value: a.id, label: a.name })),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{m['admin.agent.logs']()}</CardTitle>
        <CardDescription>{m['admin.agent.logs_hint']()}</CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={query.data?.items ?? []}
          total={query.data?.total ?? 0}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          rowKey={(e) => e.id}
          emptyText={m['admin.agent.no_logs']()}
          onRefresh={() => query.refetch()}
          loading={query.isFetching || query.isPending}
          toolbar={
            <Select
              items={agentItems}
              value={agentId}
              onValueChange={(v) => {
                setAgentId(v ? String(v) : ALL);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agentItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </CardContent>
    </Card>
  );
}
