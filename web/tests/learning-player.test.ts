import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StudyPlayback, type StudyPlayer } from '../src/lib/learning-player';
test('record changes seek and replay on one player; video changes load without reconstructing it', () => {
 const calls: unknown[][] = [];
 const player: StudyPlayer = {
  cueVideoById: value => {calls.push(['cue',value]);},
  loadVideoById: value => {calls.push(['load',value]);},
  seekTo: (...args) => {calls.push(['seek',...args]);},
  getPlayerState: () => 2,
  getPlaybackRate: () => 1, getAvailablePlaybackRates: () => [1], setPlaybackRate: () => {},
  playVideo: () => {calls.push(['play']);}, pauseVideo: () => {calls.push(['pause']);}, destroy: () => {calls.push(['destroy']);},
 };
 const playback = new StudyPlayback(player);
 playback.select('abcdefghijk', 14, false);
 playback.select('abcdefghijk', 83, true);
 playback.select('abcdefghijk', 83, true);
 playback.pause();
 playback.select('zyxwvutsrqp', 9, true);
 playback.select('', 0, false);
 assert.deepEqual(calls, [['cue',{videoId:'abcdefghijk',startSeconds:14}],['seek',83,true],['play'],['seek',83,true],['play'],['pause'],['load',{videoId:'zyxwvutsrqp',startSeconds:9}],['pause']]);
});

test('toggle pauses playing/buffering and resumes paused/cued/ended video without seeking', () => {
 const calls: string[] = [];
 let state = 1;
 const player: StudyPlayer = {
  getPlayerState: () => state,
  getPlaybackRate: () => 1, getAvailablePlaybackRates: () => [1], setPlaybackRate: () => {},
  playVideo: () => { calls.push('play'); },
  pauseVideo: () => { calls.push('pause'); },
  seekTo: () => { assert.fail('toggle must preserve the playback position'); },
  cueVideoById: () => { assert.fail('toggle must not reload the video'); },
  loadVideoById: () => { assert.fail('toggle must not reload the video'); },
  destroy: () => {},
 };
 const playback = new StudyPlayback(player);
 for (state of [1, 2, 1, 3, 5, 0, -1]) playback.toggle();
 assert.deepEqual(calls, ['pause', 'play', 'pause', 'pause', 'play', 'play', 'play']);
});


test('speed steps through supported rates, respects bounds and resets to normal', () => {
 let rate = 1;
 const calls: number[] = [];
 const player: StudyPlayer = {
  getPlayerState: () => 2,
  getPlaybackRate: () => rate,
  getAvailablePlaybackRates: () => [2, 0.5, 1, 1.5],
  setPlaybackRate: value => { rate = value; calls.push(value); },
  playVideo: () => { assert.fail('speed change must not start playback'); },
  pauseVideo: () => { assert.fail('speed change must not pause playback'); },
  seekTo: () => { assert.fail('speed change must preserve position'); },
  cueVideoById: () => { assert.fail('speed change must not reload video'); },
  loadVideoById: () => { assert.fail('speed change must not reload video'); },
  destroy: () => {},
 };
 const playback = new StudyPlayback(player);
 for (const direction of [-1, -1, 0, 1, 1, 1, 0] as const) playback.changeRate(direction);
 assert.deepEqual(calls, [0.5, 1, 1.5, 2, 1]);
 player.getAvailablePlaybackRates = () => [];
 playback.changeRate(1);
 assert.equal(calls.length, 5);
});
