import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { lookupWordNet } from '@/lib/wordnet';
import { respData, respErr } from '@/lib/resp';
import { authorizeLearning } from '@/server/learning/api';

export async function handleWordNet(request: Request) {
  const access = await authorizeLearning(request);
  if (access.response) return access.response;
  const word = z.string().trim().min(1).max(100).safeParse(new URL(request.url).searchParams.get('word'));
  if (!word.success) return respErr('Invalid word', { status: 400 });
  try {
    const result = await lookupWordNet(word.data, request.signal);
    return respData(result, { headers: { 'cache-control': 'private, max-age=86400' } });
  } catch {
    return respErr('Unable to load WordNet definitions', { status: 502 });
  }
}

export const Route = createFileRoute('/api/wordnet')({
  server: { handlers: { GET: ({ request }) => handleWordNet(request) } },
});
