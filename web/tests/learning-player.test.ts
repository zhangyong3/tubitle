import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StudyPlayback, type StudyPlayer } from '../src/lib/learning-player';
test('record changes seek and replay on one player; video changes load without reconstructing it', () => {
 const calls: unknown[][] = [];
 const player: StudyPlayer = {
  cueVideoById: value => {calls.push(['cue',value]);},
  loadVideoById: value => {calls.push(['load',value]);},
  seekTo: (...args) => {calls.push(['seek',...args]);},
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
