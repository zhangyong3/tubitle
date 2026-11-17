import { z } from 'zod';

export const learningInput = z
  .object({
    clientRecordId: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[\w-]+$/)
      .optional(),
    kind: z.enum(['word', 'sentence']),
    text: z.string().trim().min(1).max(2000),
    context: z.string().trim().max(4000).default(''),
    translation: z.string().trim().max(4000).default(''),
    note: z.string().trim().max(4000).default(''),
    analysis: z.string().trim().max(50000).default(''),
    videoId: z.union([z.literal(''), z.string().regex(/^[A-Za-z0-9_-]{11}$/)]),
    videoTitle: z.string().trim().max(300).default(''),
    startSeconds: z.number().int().min(0).max(604800),
    endSeconds: z.number().int().min(0).max(604800).nullable().default(null),
  })
  .strict()
  .refine((v) => v.endSeconds === null || v.endSeconds > v.startSeconds, {
    message: 'End time must be after start time',
    path: ['endSeconds'],
  });

export const learningUpdate = z
  .object({
    id: z.string().min(1).max(100),
    status: z.enum(['new', 'learning', 'mastered']),
  })
  .strict();

export type LearningInput = z.input<typeof learningInput>;
export interface LearningItem {
  id: string;
  clientRecordId: string;
  kind: 'word' | 'sentence';
  text: string;
  context: string;
  translation: string;
  note: string;
  analysis: string | null;
  videoId: string;
  videoTitle: string;
  startSeconds: number;
  endSeconds: number | null;
  status: 'new' | 'learning' | 'mastered';
  createdAt: string;
  updatedAt: string;
}
export interface LearningList {
  items: LearningItem[];
  total: number;
  summary: {
    total: number;
    words: number;
    sentences: number;
    mastered: number;
    videos: number;
  };
}
export function videoLink(videoId: string, seconds: number) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.floor(seconds)}s`;
}
export function formatVideoTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
