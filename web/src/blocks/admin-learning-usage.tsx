import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { matchPermission } from '@/core/auth/rbac';
import { apiGet } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { PodcastDetail, type PodcastRow } from './podcast-library';

export function AdminLearningUsage({ userId }: { userId: string }) {
  const permissions = useUserPermissions().data?.permissions || [];
  const canUsage = matchPermission('admin.usage.read', permissions);
  const canPodcasts = matchPermission('admin.podcasts.read', permissions);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const usage = useQuery({
    queryKey: ['admin-usage', userId],
    queryFn: () =>
      apiGet<{
        days: { day: string; translations: number; playbackMs: number }[];
        totals: {
          translations: number;
          playbackMs: number;
          podcasts: number;
          listenedMs: number;
          lastActiveAt: string | null;
        };
      }>(`/api/admin/users/usage?userId=${encodeURIComponent(userId)}`),
    enabled: canUsage,
  });
  const podcasts = useQuery({
    queryKey: ['admin-podcasts', userId, page],
    queryFn: () =>
      apiGet<PodcastRow[]>(
        `/api/admin/users/podcasts?userId=${encodeURIComponent(userId)}&page=${page}`
      ),
    enabled: canPodcasts,
  });
  const t = usage.data?.totals;
  const duration = (ms: number) => `${Math.round(ms / 60000)} min`;
  return (
    <section className="space-y-5">
      {canUsage && (
        <Card>
          <CardHeader>
            <CardTitle>{m['podcast.usage']()}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-xs">
              {m['podcast.usageHint']()}
            </p>
            {usage.isError ? (
              <p role="alert">{m['podcast.loadError']()}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {[
                    [m['podcast.translations'](), t?.translations || 0],
                    [m['podcast.playback'](), duration(t?.playbackMs || 0)],
                    [m['podcast.episodes'](), t?.podcasts || 0],
                    [m['podcast.listened'](), duration(t?.listenedMs || 0)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border p-4">
                      <p className="text-muted-foreground text-xs">{label}</p>
                      <p className="mt-2 text-xl font-semibold tabular-nums">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                {t?.lastActiveAt && (
                  <p className="text-muted-foreground text-xs">
                    {m['podcast.lastActive']()}:{' '}
                    {new Date(t.lastActiveAt).toLocaleString()}
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start">
                        <th className="p-2 text-start">{m['podcast.day']()}</th>
                        <th className="p-2 text-end">
                          {m['podcast.translations']()}
                        </th>
                        <th className="p-2 text-end">
                          {m['podcast.playback']()}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.data?.days.map((d) => (
                        <tr key={d.day} className="border-b">
                          <td className="p-2">{d.day}</td>
                          <td className="p-2 text-end tabular-nums">
                            {d.translations}
                          </td>
                          <td className="p-2 text-end tabular-nums">
                            {duration(d.playbackMs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
      {canPodcasts && (
        <Card>
          <CardHeader>
            <CardTitle>{m['podcast.title']()}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-xs">
              {m['podcast.retention']()}
            </p>
            {podcasts.isError ? (
              <p role="alert">{m['podcast.loadError']()}</p>
            ) : (
              podcasts.data?.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{row.title || row.id}</p>
                    <p className="text-muted-foreground text-xs">
                      {row.sourceLanguage} → {row.translationLanguage} ·{' '}
                      {new Date(row.createdAt).toLocaleString()} · {row.status}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setSelected(selected === row.id ? null : row.id)
                    }
                  >
                    {m['podcast.open']()}
                  </Button>
                </div>
              ))
            )}
            <div className="flex justify-end gap-2">
              <Button
                disabled={page === 1}
                variant="ghost"
                onClick={() => setPage((p) => p - 1)}
              >
                {m['podcast.previous']()}
              </Button>
              <Button
                disabled={(podcasts.data?.length || 0) < 10}
                variant="ghost"
                onClick={() => setPage((p) => p + 1)}
              >
                {m['podcast.next']()}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {selected && (
        <PodcastDetail key={selected} id={selected} adminUserId={userId} />
      )}
    </section>
  );
}
