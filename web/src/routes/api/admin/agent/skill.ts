import { createFileRoute } from '@tanstack/react-router';

// Bundled at build time (no fs on Workers). Public on purpose: the skill is
// generic instructions + a dependency-free client; credentials come from the
// agent's own environment, never from these files.
import client from '../../../../../.claude/skills/shipany-admin/scripts/admin-client.mjs?raw';
import skill from '../../../../../.claude/skills/shipany-admin/SKILL.md?raw';

const FILES: Record<string, { body: string; type: string }> = {
  'SKILL.md': { body: skill, type: 'text/markdown; charset=utf-8' },
  'admin-client.mjs': { body: client, type: 'text/javascript; charset=utf-8' },
};

// The file name rides in the query (?file=SKILL.md), not the path: the Vite
// dev server serves any path ending in .md/.mjs as a static file and never
// hands it to the app.
export const Route = createFileRoute('/api/admin/agent/skill')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const name = new URL(request.url).searchParams.get('file') || '';
        const file = Object.hasOwn(FILES, name) ? FILES[name] : undefined;
        if (!file) return new Response('Not found', { status: 404 });
        return new Response(file.body, {
          headers: {
            'Content-Type': file.type,
            'Cache-Control': 'public, max-age=300',
          },
        });
      },
    },
  },
});
