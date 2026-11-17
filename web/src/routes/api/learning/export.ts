import { createFileRoute } from '@tanstack/react-router';
import { authorizeLearning } from '@/server/learning/api';

import { exportRecords } from '@/modules/learning/service';
import { respErr } from '@/lib/resp';

export const Route = createFileRoute('/api/learning/export')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const access = await authorizeLearning(request);
        if (access.response) return access.response;
        try {
          return Response.json(
            {
              version: 1,
              exportedAt: new Date().toISOString(),
              records: await exportRecords(access.userId!),
            },
            {
              headers: {
                'cache-control': 'private, no-store',
                'content-disposition':
                  'attachment; filename="tubitle-learning.json"',
              },
            }
          );
        } catch {
          return respErr('Unable to export records', { status: 500 });
        }
      },
    },
  },
});
