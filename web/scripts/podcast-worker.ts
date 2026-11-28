import { getAllConfigs } from '../src/modules/config/service';
import { cleanup, tick } from '../src/server/podcasts/runner';

let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
const mode = process.argv[2] || 'worker';
if (mode === 'cleanup') {
  const result = await cleanup(await getAllConfigs());
  console.info('Podcast cleanup', result);
  if (result.failed) process.exitCode = 1;
} else if (mode === 'tick') await tick();
else {
  console.info('Local podcast worker started; Ctrl+C to stop.');
  while (!stopping) {
    try {
      await tick();
    } catch {
      console.error(
        'Podcast maintenance/generation failed; retrying next tick.'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
