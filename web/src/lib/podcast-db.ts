import { envConfigs } from '@/config';

export const sqlTime = (date: Date) =>
  ['sqlite', 'd1', 'turso'].includes(envConfigs.database_provider)
    ? date.getTime()
    : date.toISOString().replace('T', ' ').replace('Z', '');
