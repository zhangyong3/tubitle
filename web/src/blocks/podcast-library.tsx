import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  Headphones,
  Languages,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';

import { tDynamic } from '@/core/i18n/dynamic';
import { Link } from '@/core/i18n/navigation';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api-client';
import { podcastLanguages, type PodcastScript } from '@/lib/podcast';
import {
  podcastClock,
  podcastPositionAt,
  podcastTimeAt,
} from '@/lib/podcast-timeline';
import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { useConfirm } from '@/hooks/use-confirm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type PodcastRow = {
  id: string;
  title: string;
  status: string;
  sourceLanguage: string;
  translationLanguage: string;
  createdAt: string;
  expiresAt: string;
  publishedAt: string | null;
  durationMs: number;
  listenedMs: number;
  progress: number;
  progressOffset: number;
  completedAt: string | null;
  lastListenedAt: string | null;
  errorCode: string | null;
  script: PodcastScript | null;
  manifest: { durationMs: number }[];
};
type Library = {
  plan: 'free' | 'pro';
  notice: boolean;
  preference: {
    language: string;
    enabled: number;
    nextDueAt: string | null;
    trialConsumedAt: string | null;
  };
  episodes: PodcastRow[];
};
const label = (code: string) => {
  try {
    return (
      new Intl.DisplayNames([getLocale()], { type: 'language' }).of(code) ||
      code
    );
  } catch {
    return code;
  }
};
const minutes = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
function showError(error: Error) {
  const key = `podcast.${error.message}`;
  toast.error(
    [
      'NOT_ENOUGH_MATERIAL',
      'CONFIRM_PODCAST_LANGUAGE',
      'TRIAL_USED',
      'PODCAST_NOT_DUE',
      'PODCAST_NOT_CONFIGURED',
      'PODCAST_REQUEST_FAILED',
    ].includes(error.message)
      ? tDynamic(key)
      : m['podcast.error']()
  );
}
export function PodcastLanguageSettings() {
  const query = useQuery({
    queryKey: ['podcasts', 1],
    queryFn: () => apiGet<Library>('/api/podcasts'),
  });
  const client = useQueryClient();
  const [language, setLanguage] = useState('');
  useEffect(() => {
    if (query.data) setLanguage(query.data.preference.language || getLocale());
  }, [query.data?.preference.language]);
  const save = useMutation({
    mutationFn: () => apiPatch('/api/podcasts', { language }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['podcasts'] });
      toast.success(m['podcast.saved']());
    },
    onError: showError,
  });
  return (
    <Card id="podcast-language">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="size-4" />
          {m['podcast.language']()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">
          {m['podcast.languageHint']()}
        </p>
        <div className="flex flex-wrap gap-3">
          <select
            aria-label={m['podcast.language']()}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-background rounded-md border p-2 text-sm"
          >
            {podcastLanguages.map((l) => (
              <option key={l} value={l}>
                {label(l)}
              </option>
            ))}
          </select>
          <Button
            disabled={save.isPending || !language}
            onClick={() => save.mutate()}
          >
            {m['podcast.save']()}
          </Button>
        </div>
        {query.isError && <p role="alert">{m['podcast.loadError']()}</p>}
      </CardContent>
    </Card>
  );
}
export function PodcastRegistrationNotice() {
  const query = useQuery({
    queryKey: ['podcasts', 1],
    queryFn: () => apiGet<Library>('/api/podcasts'),
  });
  const client = useQueryClient();
  const dismiss = useMutation({
    mutationFn: () => apiPatch('/api/podcasts', { dismissNotice: true }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['podcasts'] }),
  });
  if (!query.data?.notice) return null;
  return (
    <div
      role="status"
      className="bg-card mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm"
    >
      <p>
        {m['podcast.notice']()}{' '}
        <strong>{label(query.data.preference.language || getLocale())}</strong>
      </p>
      <Link
        href="/settings/podcasts#podcast-language"
        className="text-primary underline"
      >
        {m['podcast.openSettings']()}
      </Link>
      <Button
        variant="ghost"
        disabled={dismiss.isPending}
        onClick={() => dismiss.mutate()}
      >
        {m['podcast.dismiss']()}
      </Button>
    </div>
  );
}
export function PodcastLibrary() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['podcasts', page],
    queryFn: () => apiGet<Library>(`/api/podcasts?page=${page}`),
    refetchInterval: 10000,
  });
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const generate = useMutation({
    mutationFn: () => apiPost<PodcastRow>('/api/podcasts'),
    onSuccess: (r) => {
      setSelected(r.id);
      client.invalidateQueries({ queryKey: ['podcasts'] });
    },
    onError: showError,
  });
  const toggle = useMutation({
    mutationFn: () =>
      apiPatch('/api/podcasts', { enabled: !query.data?.preference.enabled }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['podcasts'] }),
    onError: showError,
  });
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
      <header className="space-y-2">
        <div className="text-primary flex items-center gap-2">
          <Headphones className="size-5" />
          <span className="text-sm">{m['podcast.title']()}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {m['podcast.title']()}
        </h1>
        <p className="text-muted-foreground">{m['podcast.description']()}</p>
        <p className="text-muted-foreground text-sm">
          {m['podcast.retention']()}
        </p>
        <p className="text-muted-foreground text-xs">
          {m['podcast.privacy']()}
        </p>
      </header>
      <PodcastLanguageSettings />
      {query.isPending ? (
        <p role="status">{m['tubitle.membership.loading']()}</p>
      ) : query.isError ? (
        <div role="alert">
          <p>{m['podcast.loadError']()}</p>
          <Button onClick={() => query.refetch()}>
            {m['podcast.retry']()}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={generate.isPending}
              onClick={() => generate.mutate()}
            >
              {query.data?.plan === 'pro'
                ? m['podcast.generate']()
                : m['podcast.trial']()}
            </Button>
            {query.data?.plan === 'pro' && (
              <Button
                variant="outline"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate()}
              >
                {query.data.preference.enabled
                  ? m['podcast.pause']()
                  : m['podcast.enable']()}
              </Button>
            )}
            {query.data?.preference.nextDueAt && (
              <span className="text-muted-foreground text-sm">
                {new Date(query.data.preference.nextDueAt).toLocaleString()}
              </span>
            )}
          </div>
          {!query.data?.episodes.length && (
            <Card>
              <CardContent className="text-muted-foreground flex min-h-48 items-center justify-center p-8 text-center">
                {m['podcast.empty']()}
              </CardContent>
            </Card>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {query.data?.episodes.map((row) => (
              <Card key={row.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary">
                      {label(row.sourceLanguage)} →{' '}
                      {label(row.translationLanguage)}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {tDynamic(
                        `podcast.${row.status === 'retry' ? 'retryStatus' : row.status}`
                      )}
                    </span>
                  </div>
                  <CardTitle>{row.title || m['podcast.title']()}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-muted-foreground flex gap-3 text-xs">
                    <span>{new Date(row.createdAt).toLocaleDateString()}</span>
                    <span className="flex gap-1">
                      <Clock className="size-3" />
                      {minutes(row.durationMs)}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setSelected(selected === row.id ? null : row.id)
                    }
                  >
                    {m['podcast.open']()}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {m['podcast.previous']()}
            </Button>
            <Button
              variant="ghost"
              disabled={(query.data?.episodes.length || 0) < 10}
              onClick={() => setPage((p) => p + 1)}
            >
              {m['podcast.next']()}
            </Button>
          </div>
        </>
      )}
      <PodcastMaterialLanguages />
      {selected && <PodcastDetail key={selected} id={selected} />}
    </div>
  );
}
export function PodcastDetail({
  id,
  adminUserId,
}: {
  id: string;
  adminUserId?: string;
}) {
  const admin = !!adminUserId;
  const base = admin
    ? `/api/admin/users/podcasts?userId=${encodeURIComponent(adminUserId!)}&id=${encodeURIComponent(id)}`
    : `/api/podcasts/${id}`;
  const query = useQuery({
    queryKey: ['podcast-detail', adminUserId, id],
    queryFn: () =>
      apiGet<{
        episode: PodcastRow;
        sources: {
          id: string;
          text: string;
          videoId?: string;
          startSeconds?: number;
        }[];
      }>(base),
    refetchInterval: 10000,
  });
  const row = query.data?.episode;
  const client = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [index, setIndex] = useState(0);
  const [rate, setRate] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [draft, setDraft] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const loadedIndex = useRef(0);
  const audio = useRef<HTMLAudioElement>(null);
  const playbackClient = useRef('');
  const seq = useRef(0);
  const last = useRef<number | null>(null);
  const elapsed = useRef(0);
  const lastFlush = useRef(0);
  const resume = useRef(false);
  const restored = useRef(false);
  const restoreOffset = useRef(0);
  useEffect(() => {
    if (row?.status === 'ready' && !restored.current && !admin) {
      restored.current = true;
      setIndex(Math.min(row.progress, row.manifest.length - 1));
      restoreOffset.current = row.progressOffset;
      setTime(
        podcastTimeAt(
          row.manifest,
          Math.min(row.progress, row.manifest.length - 1),
          row.progressOffset
        )
      );
    }
  }, [row?.status]);
  useEffect(() => {
    playbackClient.current = crypto.randomUUID();
  }, []);
  const flush = () => {
    if (admin || !row || !audio.current) return;
    const deltaMs = Math.min(30000, Math.round(elapsed.current));
    elapsed.current = 0;
    lastFlush.current = performance.now();
    void apiPut(`/api/podcasts/${id}`, {
      client: playbackClient.current,
      sequence: ++seq.current,
      segment: loadedIndex.current,
      offset: Math.round(audio.current.currentTime * 1000),
      deltaMs,
    }).catch(() => undefined);
  };
  const onTime = () => {
    if (
      audio.current &&
      row &&
      audio.current.readyState > 0 &&
      loadedIndex.current === index
    )
      setTime(
        podcastTimeAt(row.manifest, index, audio.current.currentTime * 1000)
      );
    const now = performance.now();
    if (
      audio.current &&
      !audio.current.paused &&
      !audio.current.seeking &&
      last.current !== null
    ) {
      const d = now - last.current;
      if (d > 0 && d < 2000) elapsed.current += d;
    }
    last.current = now;
    if (now - lastFlush.current > 15000) flush();
  };
  useEffect(() => {
    const el = audio.current;
    if (el) {
      el.playbackRate = rate;
    }
  }, [rate]);
  const retry = useMutation({
    mutationFn: () => apiPost(`/api/podcasts/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['podcast-detail'] }),
    onError: showError,
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/api/podcasts/${id}`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['podcasts'] });
      client.invalidateQueries({ queryKey: ['podcast-detail'] });
    },
    onError: showError,
  });
  const choose = (n: number, offsetMs = 0, autoplay = true) => {
    flush();
    last.current = null;
    setDraft(null);
    if (!row || !audio.current) return;
    setTime(podcastTimeAt(row.manifest, n, offsetMs));
    resume.current = autoplay;
    if (n === index && audio.current.readyState > 0) {
      audio.current.currentTime = offsetMs / 1000;
      if (autoplay) void audio.current.play().catch(() => setPlaying(false));
      flush();
    } else {
      restoreOffset.current = offsetMs;
      setIndex(n);
    }
  };
  const seek = (target: number) => {
    if (!row) return;
    const position = podcastPositionAt(row.manifest, target);
    choose(
      position.index,
      position.offsetMs,
      !!audio.current && !audio.current.paused
    );
  };
  if (query.isPending)
    return <p role="status">{m['tubitle.membership.loading']()}</p>;
  if (query.isError || !row)
    return <p role="alert">{m['podcast.loadError']()}</p>;
  const total = row.manifest.reduce((sum, part) => sum + part.durationMs, 0);
  const url = admin
    ? `/api/admin/podcasts/${id}/audio/${index}`
    : `${base}/audio/${index}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{row.title || m['podcast.title']()}</CardTitle>
        <p className="text-muted-foreground text-xs">
          {m['podcast.expires']()}: {new Date(row.expiresAt).toLocaleString()}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {row.status === 'ready' && (
          <>
            <audio
              ref={audio}
              preload="metadata"
              src={url}
              className="hidden"
              onPlay={() => {
                setPlaying(true);
                last.current = null;
                flush();
              }}
              onTimeUpdate={onTime}
              onSeeking={() => {
                last.current = null;
              }}
              onPause={() => {
                setPlaying(false);
                last.current = null;
                flush();
              }}
              onEnded={() => {
                if (index < row.manifest.length - 1) {
                  choose(index + 1, 0, true);
                } else {
                  setPlaying(false);
                  setTime(total);
                  flush();
                }
              }}
              onLoadedMetadata={() => {
                if (audio.current) {
                  loadedIndex.current = index;
                  audio.current.playbackRate = rate;
                  audio.current.volume = volume;
                  audio.current.muted = muted;
                  if (restoreOffset.current) {
                    audio.current.currentTime = restoreOffset.current / 1000;
                    restoreOffset.current = 0;
                  }
                  if (resume.current)
                    void audio.current.play().catch(() => setPlaying(false));
                  flush();
                }
              }}
              onError={() => {
                setPlaying(false);
                last.current = null;
              }}
            />
            <div className="bg-muted/50 rounded-xl border p-3 sm:p-4">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={
                    playing
                      ? m['podcast.pauseAudio']()
                      : m['podcast.playAudio']()
                  }
                  onClick={() => {
                    const el = audio.current;
                    if (!el) return;
                    if (!el.paused) el.pause();
                    else if (time >= total) choose(0);
                    else void el.play().catch(() => setPlaying(false));
                  }}
                >
                  {playing ? (
                    <Pause className="size-5" />
                  ) : (
                    <Play className="size-5" />
                  )}
                </Button>
                <span className="shrink-0 text-sm tabular-nums">
                  {podcastClock(draft ?? time)} / {podcastClock(total)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={total}
                  step={100}
                  value={draft ?? time}
                  aria-label={m['podcast.timeline']()}
                  aria-valuetext={`${podcastClock(draft ?? time)} / ${podcastClock(total)}`}
                  className="accent-primary min-w-0 flex-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4"
                  onChange={(e) => setDraft(Number(e.target.value))}
                  onPointerUp={(e) => seek(Number(e.currentTarget.value))}
                  onKeyUp={(e) => seek(Number(e.currentTarget.value))}
                  onBlur={(e) => {
                    if (draft !== null) seek(Number(e.currentTarget.value));
                  }}
                  onPointerCancel={() => setDraft(null)}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 pl-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={
                    muted ? m['podcast.unmute']() : m['podcast.mute']()
                  }
                  onClick={() => {
                    if (audio.current) audio.current.muted = !muted;
                    setMuted(!muted);
                  }}
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="size-4" />
                  ) : (
                    <Volume2 className="size-4" />
                  )}
                </Button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  aria-label={m['podcast.volume']()}
                  className="accent-primary w-20 cursor-pointer"
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setVolume(value);
                    setMuted(false);
                    if (audio.current) {
                      audio.current.volume = value;
                      audio.current.muted = false;
                    }
                  }}
                />
                <select
                  aria-label={m['podcast.speed']()}
                  className="bg-background rounded border p-1"
                  value={rate}
                  onChange={(e) => setRate(Number(e.target.value))}
                >
                  {[0.75, 1, 1.25, 1.5].map((r) => (
                    <option key={r} value={r}>
                      {r}×
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground text-xs">
                  {m['podcast.generated']()}
                </span>
              </div>
            </div>
          </>
        )}
        {row.errorCode && (
          <p role="status" className="text-muted-foreground text-sm">
            {tDynamic(
              `podcast.${row.status === 'retry' ? 'retryStatus' : row.status}`
            )}{' '}
            · {row.errorCode}
          </p>
        )}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-medium">{m['podcast.transcript']()}</h2>
            {row.script && (
              <Button
                variant="outline"
                onClick={() => {
                  const text = [
                    row.title,
                    `${row.sourceLanguage} → ${row.translationLanguage}`,
                    ...row.script!.segments.map((s) => s.spokenText),
                    ...(query.data?.sources || []).map(
                      (s) =>
                        `${s.text}${s.videoId ? ` https://www.youtube.com/watch?v=${s.videoId}&t=${s.startSeconds || 0}s` : ''}`
                    ),
                  ].join('\n\n');
                  const url = URL.createObjectURL(
                    new Blob([text], { type: 'text/plain;charset=utf-8' })
                  );
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `podcast-${id}.txt`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                {m['podcast.export']()}
              </Button>
            )}
          </div>
          {row.script?.segments.map((s, n) => (
            <button
              type="button"
              key={n}
              onClick={() => row.status === 'ready' && choose(n)}
              className={`block w-full rounded-lg border p-4 text-start text-sm leading-7 transition-colors ${n === index ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
            >
              <span className="text-muted-foreground mb-1 block text-xs">
                {n + 1} · {label(s.language)}
              </span>
              <span lang={s.language}>
                <MarkedText
                  text={s.spokenText}
                  terms={query.data?.sources.map((s) => s.text) || []}
                />
              </span>
            </button>
          ))}
        </section>
        <section className="space-y-2">
          <h2 className="font-medium">{m['podcast.sources']()}</h2>
          {query.data?.sources.map((s) => (
            <p className="text-sm" key={s.id}>
              {s.videoId ? (
                <a
                  href={`https://www.youtube.com/watch?v=${encodeURIComponent(s.videoId)}&t=${s.startSeconds || 0}s`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  {s.text}
                </a>
              ) : (
                s.text
              )}
            </p>
          ))}
        </section>
        {admin ? (
          <p className="text-sm">
            {m['podcast.listened']()}: {minutes(row.listenedMs)} ·{' '}
            {m['podcast.progress']()} {row.progress + 1} ·{' '}
            {row.completedAt
              ? m['podcast.completed']()
              : m['podcast.incomplete']()}
            {row.lastListenedAt &&
              ` · ${new Date(row.lastListenedAt).toLocaleString()}`}
          </p>
        ) : (
          <div className="flex gap-2">
            {['failed', 'blocked'].includes(row.status) && (
              <Button disabled={retry.isPending} onClick={() => retry.mutate()}>
                {m['podcast.retry']()}
              </Button>
            )}
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: m['podcast.delete'](),
                    description: m['podcast.confirmDelete'](),
                  })
                )
                  remove.mutate();
              }}
            >
              {m['podcast.delete']()}
            </Button>
          </div>
        )}
        {dialog}
      </CardContent>
    </Card>
  );
}

function PodcastMaterialLanguages() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [language, setLanguage] = useState('en');
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['podcast-materials', page],
    queryFn: () =>
      apiGet<{ id: string; text: string; context: string }[]>(
        `/api/podcasts/materials?page=${page}`
      ),
  });
  const save = useMutation({
    mutationFn: () =>
      apiPatch('/api/podcasts/materials', { ids: selected, language }),
    onSuccess: () => {
      setSelected([]);
      client.invalidateQueries({ queryKey: ['podcast-materials'] });
    },
    onError: showError,
  });
  if (!query.data?.length && page === 1) return null;
  return (
    <details className="bg-card rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">
        {m['podcast.materials']()}
      </summary>
      <div className="mt-4 space-y-3">
        <p className="text-muted-foreground text-sm">
          {m['podcast.materialsHint']()}
        </p>
        <select
          aria-label={m['podcast.sourceLanguage']()}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="bg-background rounded border p-2"
        >
          {podcastLanguages.map((l) => (
            <option key={l} value={l}>
              {label(l)}
            </option>
          ))}
        </select>
        {query.data?.map((record) => (
          <label
            key={record.id}
            className="flex items-start gap-3 rounded border p-3 text-sm"
          >
            <input
              type="checkbox"
              checked={selected.includes(record.id)}
              onChange={(e) =>
                setSelected((s) =>
                  e.target.checked
                    ? [...s, record.id]
                    : s.filter((id) => id !== record.id)
                )
              }
            />
            <span>
              {record.text}
              <span className="text-muted-foreground mt-1 block">
                {record.context}
              </span>
            </span>
          </label>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!selected.length || save.isPending}
            onClick={() => save.mutate()}
          >
            {m['podcast.confirmLanguage']()}
          </Button>
          <Button
            variant="ghost"
            disabled={page === 1}
            onClick={() => {
              setSelected([]);
              setPage((p) => p - 1);
            }}
          >
            {m['podcast.previous']()}
          </Button>
          <Button
            variant="ghost"
            disabled={(query.data?.length || 0) < 20}
            onClick={() => {
              setSelected([]);
              setPage((p) => p + 1);
            }}
          >
            {m['podcast.next']()}
          </Button>
        </div>
      </div>
    </details>
  );
}

function MarkedText({ text, terms }: { text: string; terms: string[] }) {
  const words = terms
    .filter((t) => t.trim() && t.length <= 200)
    .map((t) => t.toLocaleLowerCase())
    .sort((a, b) => b.length - a.length);
  const lower = text.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let next = text.length;
    let match = '';
    for (const word of words) {
      const at = lower.indexOf(word, cursor);
      if (
        at >= 0 &&
        (at < next || (at === next && word.length > match.length))
      ) {
        next = at;
        match = word;
      }
    }
    if (!match) {
      parts.push(text.slice(cursor));
      break;
    }
    if (next > cursor) parts.push(text.slice(cursor, next));
    parts.push(
      <mark key={next} className="bg-primary/15 rounded px-0.5 text-inherit">
        {text.slice(next, next + match.length)}
      </mark>
    );
    cursor = next + match.length;
  }
  return <>{parts}</>;
}
