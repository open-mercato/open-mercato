/**
 * Renders an id list into a raw-SQL `IN` clause with one placeholder per member.
 *
 * MikroORM does not bind parameters at the driver level: `AbstractSqlConnection.execute`
 * calls `platform.formatQuery`, which interpolates each value through
 * `BasePostgreSqlPlatform.escape`, and that renders a JavaScript array as a bare
 * comma-separated list. `column = ANY(?)` therefore reaches PostgreSQL as
 * `= ANY('a', 'b')` — or, for a single-element array, as the bare scalar, which fails
 * with `malformed array literal`. The dashboards aggregation builder hit the same wall
 * (#4669) and settled on one placeholder per member; this is that same fix, shared by
 * the time-tracking raw queries.
 *
 * An empty list yields `IN (NULL)` rather than a dropped clause: a caller that narrowed
 * to nothing must select nothing, never silently widen to every row.
 */
export type SqlInClause = { sql: string; params: unknown[] }

export function buildSqlInClause(column: string, values: readonly string[]): SqlInClause {
  if (values.length === 0) return { sql: `${column} IN (NULL)`, params: [] }
  const placeholders = values.map(() => '?').join(', ')
  return { sql: `${column} IN (${placeholders})`, params: [...values] }
}
