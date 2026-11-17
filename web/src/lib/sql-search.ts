import { eq, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Keyword filter for admin list search: case-insensitive substring match on
 * `contains` columns, exact match on `exact` columns (ids). Portable across
 * SQLite/Postgres/MySQL (lower() + LIKE with an explicit `!` escape char, so
 * `%`/`_` in the keyword are literal). Returns undefined for a blank keyword.
 */
export function keywordMatch(
  keyword: string | null | undefined,
  columns: { contains?: AnyColumn[]; exact?: AnyColumn[] }
): SQL | undefined {
  const term = keyword?.trim();
  if (!term) return undefined;
  const pattern = `%${term.toLowerCase().replace(/[!%_]/g, '!$&')}%`;
  return or(
    ...(columns.contains ?? []).map(
      (col) => sql`lower(${col}) like ${pattern} escape '!'`
    ),
    ...(columns.exact ?? []).map((col) => eq(col, term))
  );
}
