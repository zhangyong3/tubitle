import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Download, Pause, Play, RotateCcw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from '@/core/auth/client';
import { apiDelete, apiGet, apiPatch } from '@/lib/api-client';
import { formatVideoTime, type LearningList, type LearningItem } from '@/lib/learning';
import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { useConfirm } from '@/hooks/use-confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LearningPlayer, type LearningPlayerHandle } from './learning-player';

export function LearningLibrary() {
  const { data: session } = useSession();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playRequest, setPlayRequest] = useState(0);
  const playerRef = useRef<LearningPlayerHandle>(null);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const { confirm, dialog } = useConfirm();
  const queryClient = useQueryClient();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useInfiniteQuery({
    queryKey: ['learning', session?.user?.id, debounced, kind, status],
    enabled: !!session?.user,
    initialPageParam: 1,
    refetchInterval: 15000,
    queryFn: ({ pageParam }) => apiGet<LearningList>(`/api/learning?${new URLSearchParams({ search: debounced, ...(kind ? { kind } : {}), ...(status ? { status } : {}), page: String(pageParam) })}`),
    getNextPageParam: (last, pages) => pages.reduce((count, page) => count + page.items.length, 0) < last.total ? pages.length + 1 : undefined,
  });
  const items = useMemo(() => {
    const unique = new Map<string, LearningItem>();
    for (const page of query.data?.pages || []) for (const item of page.items) unique.set(item.id, item);
    return [...unique.values()];
  }, [query.data]);
  const active = items.find(item => item.id === selectedId) || items[0];
  const activeIndex = active ? items.findIndex(item => item.id === active.id) : -1;
  const groups = useMemo(() => {
    const result = new Map<string, LearningItem[]>();
    for (const item of items) {
      const date = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(item.createdAt));
      result.set(date, [...(result.get(date) || []), item]);
    }
    return [...result.entries()];
  }, [items]);
  const statusLabels = { new: m['tubitle.library.new'](), learning: m['tubitle.library.learning'](), mastered: m['tubitle.library.mastered']() };
  const mutation = useMutation({
    mutationFn: (value: { id: string; status?: string }) => value.status ? apiPatch('/api/learning', value) : apiDelete(`/api/learning?id=${encodeURIComponent(value.id)}`),
    onSuccess: (_, value) => {
      void queryClient.invalidateQueries({ queryKey: ['learning'] });
      toast.success(value.status ? m['tubitle.library.updated']() : m['tubitle.library.deleted']());
    },
    onError: () => toast.error(m['tubitle.library.saveError']()),
  });
  const select = (item: LearningItem) => { setSelectedId(item.id); setPlayRequest(value => value + 1); };
  const next = async () => {
    if (activeIndex < items.length - 1) select(items[activeIndex + 1]);
    else if (query.hasNextPage) {
      const result = await query.fetchNextPage();
      const item = result.data?.pages.at(-1)?.items[0];
      if (item) select(item);
    }
  };
  const summary = query.data?.pages[0]?.summary;
  return <div className="tt-library tt-study-workspace">
    <a className="tt-skip" href="#study-detail">{m['tubitle.library.skip']()}</a>
    <aside className="tt-study-sidebar" aria-label={m['tubitle.library.history']()}>
      <header className="tt-study-overview">
        <div className="tt-study-title"><h1>{m['tubitle.library.title']()}</h1><a href="/api/learning/export" className="tt-export" aria-label={m['tubitle.library.export']()} title={m['tubitle.library.export']()}><Download size={17} /></a></div>
        <div className="tt-study-stats" aria-busy={query.isPending}>
          {[
            { label: m['tubitle.library.total'](), value: summary?.total },
            { label: m['tubitle.library.word'](), value: summary?.words },
            { label: m['tubitle.library.sentence'](), value: summary?.sentences },
            { label: m['tubitle.library.mastered'](), value: summary?.mastered },
          ].map(stat => <div key={stat.label}><strong>{stat.value ?? '·'}</strong><span>{stat.label}</span></div>)}
        </div>
      </header>
      <section className="tt-study-history" aria-label={m['tubitle.library.manage']()}>
        <div className="tt-study-filters">
          <div className="tt-search"><Search size={16} /><Input value={search} maxLength={100} onChange={event => setSearch(event.target.value)} placeholder={m['tubitle.library.search']()} aria-label={m['tubitle.library.search']()} /></div>
          <div className="tt-study-filter-row"><div className="tt-study-tabs" role="group" aria-label={m['tubitle.library.all']()}>
            {[{ value: '', label: m['tubitle.library.all']() }, { value: 'word', label: m['tubitle.library.word']() }, { value: 'sentence', label: m['tubitle.library.sentence']() }].map(tab => <button type="button" key={tab.value} aria-pressed={kind === tab.value} onClick={() => setKind(tab.value)}>{tab.label}</button>)}
          </div><select aria-label={m['tubitle.library.statusLabel']()} value={status} onChange={event => setStatus(event.target.value)}><option value="">{m['tubitle.library.anyStatus']()}</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div className="tt-study-history-label"><h2>{m['tubitle.library.history']()}</h2><span>{query.data ? m['tubitle.library.count']({ count: query.data.pages[0].total }) : ''}</span></div>
        </div>
        <div className="tt-study-tree">
          {query.isPending ? <p className="tt-study-message" role="status">{m['tubitle.library.loading']()}</p> : query.isError ? <div className="tt-study-message" role="alert"><p>{m['tubitle.library.error']()}</p><Button variant="outline" onClick={() => void query.refetch()}>{m['tubitle.library.retry']()}</Button></div> : !items.length ? <div className="tt-study-message"><BookOpen size={24} /><p>{search || kind || status ? m['tubitle.library.noResults']() : m['tubitle.library.empty']()}</p><p>{m['tubitle.library.emptyText']()}</p></div> : groups.map(([date, records]) => <details className="tt-study-date" key={date} open>
            <summary><ChevronDown size={14} /><time dateTime={date}>{new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(new Date(records[0].createdAt))}</time><span>{records.length}</span></summary>
            <ul>{records.map(item => <li key={item.id}><button type="button" className="tt-study-entry" aria-current={active?.id === item.id ? 'true' : undefined} onClick={() => select(item)}>
              <span className={`tt-study-kind tt-study-kind-${item.kind}`}>{item.kind === 'word' ? m['tubitle.library.word']() : m['tubitle.library.sentence']()}</span><span className="tt-study-entry-text" lang="en">{item.text}</span><span className="tt-study-entry-time">{formatVideoTime(item.startSeconds)}</span>
            </button></li>)}</ul>
          </details>)}
          {query.hasNextPage && <Button className="tt-study-more" variant="ghost" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? m['tubitle.library.loading']() : m['tubitle.library.loadMore']()}</Button>}
        </div>
      </section>
      <p className="tt-study-privacy">{m['tubitle.library.privacy']()}</p>
    </aside>
    <section className="tt-study-main" id="study-detail" aria-label={m['tubitle.library.review']()}>
      <LearningPlayer ref={playerRef} videoId={active?.videoId || ''} seconds={active?.startSeconds || 0} playRequest={playRequest} onPlayingChange={setPlaying} onRateChange={setPlaybackRate} />
      <div className="tt-study-controls" aria-label={m['tubitle.library.playback']()}>
        <Button variant="outline" disabled={activeIndex <= 0} onClick={() => select(items[activeIndex - 1])}><ChevronLeft size={16} />{m['tubitle.library.previousRecord']()}</Button>
        <Button variant="outline" disabled={!active || (activeIndex === items.length - 1 && !query.hasNextPage) || query.isFetchingNextPage} onClick={() => void next()}>{m['tubitle.library.nextRecord']()}<ChevronRight size={16} /></Button>
        <Button variant="ghost" disabled={!active?.videoId} onClick={() => playerRef.current?.toggle()}>{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? m['tubitle.library.pause']() : m['tubitle.library.play']()}</Button>
        <Button variant="ghost" disabled={!active?.videoId} onClick={() => setPlayRequest(value => value + 1)}><RotateCcw size={15} />{m['tubitle.library.replay']()}</Button>
        <div className="tt-study-speed" role="group" aria-label={m['tubitle.library.speed']()}>
          <Button variant="ghost" disabled={!active?.videoId} onClick={() => playerRef.current?.changeRate(-1)}>{m['tubitle.library.slower']()}</Button>
          <Button variant="ghost" disabled={!active?.videoId} onClick={() => playerRef.current?.changeRate(0)}>{m['tubitle.library.normalSpeed']()}</Button>
          <Button variant="ghost" disabled={!active?.videoId} onClick={() => playerRef.current?.changeRate(1)}>{m['tubitle.library.faster']()}</Button>
          <span className="tt-study-rate" role="status">{playbackRate}×</span>
        </div>
        <span className="tt-study-position">{active ? `${activeIndex + 1} / ${query.data?.pages[0].total}` : ''}</span>
      </div>
      {active ? <article className="tt-study-detail">
        <div className="tt-study-detail-top"><div className="tt-study-detail-meta"><span>{active.kind === 'word' ? m['tubitle.library.word']() : m['tubitle.library.sentence']()}</span><span className="tt-video-time">{formatVideoTime(active.startSeconds)}</span></div><div className="tt-record-actions"><select aria-label={`${m['tubitle.library.statusLabel']()}: ${active.text}`} value={active.status} disabled={mutation.isPending} onChange={event => mutation.mutate({ id: active.id, status: event.target.value })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button variant="ghost" size="icon" aria-label={`${m['tubitle.library.delete']()}: ${active.text}`} disabled={mutation.isPending} onClick={async () => { if (await confirm({ title: m['tubitle.library.deleteTitle'](), description: m['tubitle.library.deleteDescription'](), destructive: true })) mutation.mutate({ id: active.id }); }}><Trash2 size={16} /></Button></div></div>
        <h2 lang="en">{active.text}</h2>
        {active.videoTitle && <p className="tt-study-source">{active.videoTitle}</p>}
        {active.translation && <section className="tt-study-explanation"><h3>{m['tubitle.library.meaning']()}</h3><p>{active.translation}</p></section>}
        {active.analysis && <section className="tt-study-explanation"><h3>{m['tubitle.library.analysis']()}</h3><div>{active.analysis}</div></section>}
        {active.context && <section className="tt-study-explanation"><h3>{m['tubitle.library.contextLabel']()}</h3><p>{active.context}</p></section>}
        {active.note && <section className="tt-study-explanation"><h3>{m['tubitle.library.noteLabel']()}</h3><p>{active.note}</p></section>}
        {!active.translation && !active.analysis && <p className="tt-study-message">{m['tubitle.library.noExplanation']()}</p>}
      </article> : <div className="tt-study-no-selection"><BookOpen size={30} /><h2>{m['tubitle.library.selectRecord']()}</h2><p>{m['tubitle.library.emptyText']()}</p></div>}
    </section>
    {dialog}
  </div>;
}
