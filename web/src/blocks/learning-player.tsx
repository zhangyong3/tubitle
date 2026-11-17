import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { PlayCircle } from 'lucide-react';
import { StudyPlayback, type StudyPlayer } from '@/lib/learning-player';
import { m } from '@/paraglide/messages.js';

type PlayerApi = { Player: new (host: HTMLElement, options: Record<string, unknown>) => StudyPlayer };
type YouTubeWindow = Window & { YT?: PlayerApi; onYouTubeIframeAPIReady?: () => void };
let apiPromise: Promise<PlayerApi> | undefined;
function loadPlayerApi() {
  const win = window as YouTubeWindow;
  if (win.YT?.Player) return Promise.resolve(win.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<PlayerApi>((resolve, reject) => {
    const previous = win.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => { script.remove(); apiPromise = undefined; reject(new Error('Player timeout')); }, 20000);
    win.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      previous?.();
      if (win.YT?.Player) resolve(win.YT);
      else { apiPromise = undefined; reject(new Error('Player unavailable')); }
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => { window.clearTimeout(timeout); script.remove(); apiPromise = undefined; reject(new Error('Player unavailable')); };
    document.head.append(script);
  });
  return apiPromise;
}
export interface LearningPlayerHandle { toggle(): void; changeRate(direction: -1 | 0 | 1): void }
export function LearningPlayer({ videoId, seconds, playRequest, ref, onPlayingChange, onRateChange }: { videoId: string; seconds: number; playRequest: number; ref?: Ref<LearningPlayerHandle>; onPlayingChange: (playing: boolean) => void; onRateChange: (rate: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const playback = useRef<StudyPlayback | null>(null);
  useImperativeHandle(ref, () => ({ toggle: () => playback.current?.toggle(), changeRate: direction => playback.current?.changeRate(direction) }), []);
  const rateChange = useRef(onRateChange);
  rateChange.current = onRateChange;
  const playingChange = useRef(onPlayingChange);
  playingChange.current = onPlayingChange;
  const latest = useRef({ videoId, seconds, playRequest });
  latest.current = { videoId, seconds, playRequest };
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Record selection is deliberately absent from these dependencies: never
  // replace the iframe when a learner switches words or sentences.
  useEffect(() => {
    let cancelled = false;
    let player: StudyPlayer | undefined;
    setError(false); setReady(false);
    playingChange.current(false);
    rateChange.current(1);
    const element = document.createElement('div');
    host.current?.append(element);
    void loadPlayerApi().then(api => {
      if (cancelled) return;
      player = new api.Player(element, {
        width: '100%', height: '100%',
        playerVars: { playsinline: 1, origin: window.location.origin, rel: 0 },
        events: {
          onReady: (event: { target: StudyPlayer }) => {
            if (cancelled) return;
            playback.current = new StudyPlayback(event.target);
            rateChange.current(event.target.getPlaybackRate());
            const current = latest.current;
            playback.current.select(current.videoId, current.seconds, current.playRequest > 0);
            setReady(true);
          },
          onStateChange: (event: { data: number }) => {
            if (!cancelled) playingChange.current(event.data === 1 || event.data === 3);
          },
          onPlaybackRateChange: (event: { data: number }) => {
            if (!cancelled) rateChange.current(event.data);
          },
          onError: () => { if (!cancelled) { setError(true); playingChange.current(false); } },
        },
      });
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; playback.current = null; player?.destroy(); element.remove(); };
  }, [attempt]);
  useEffect(() => {
    if (playback.current) {
      setError(false);
      playback.current.select(videoId, seconds, playRequest > 0);
    }
  }, [videoId, seconds, playRequest]);
  return <div className="tt-study-player" aria-label={m['tubitle.library.player']()}>
    <div ref={host} className="tt-player-host" hidden={!videoId || error} />
    {(!videoId || error || !ready) && <div className="tt-player-placeholder" role="status">
      <PlayCircle size={40} strokeWidth={1.2} />
      <p>{error ? m['tubitle.library.playerError']() : videoId ? m['tubitle.library.playerLoading']() : m['tubitle.library.selectRecord']()}</p>
      {error && <button type="button" onClick={() => setAttempt(value => value + 1)}>{m['tubitle.library.retry']()}</button>}
    </div>}
  </div>;
}
