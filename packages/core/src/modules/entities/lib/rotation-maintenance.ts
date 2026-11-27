export type MaintenanceConnection = {
  execute(query: string, parameters: unknown[]): Promise<unknown>
}
export type MaintenanceRow = Record<string, unknown>
export type MaintenanceScope = { tenantId: string; organizationId: string | null }
type MaintenanceColumnTypes = ReadonlyMap<string, 'json' | 'jsonb' | null>
export const MAINTENANCE_BATCH_SIZE = 8
export const MAINTENANCE_ROW_BYTES = 1024 * 1024

export function quoteMaintenanceIdentifier(identifier: string): string {
  if (!identifier || identifier.includes('\0')) throw new Error('[internal] Invalid maintenance identifier')
  return `"${identifier.replace(/"/g, '""')}"`
}

function unchangedColumn(column: string, type?: 'json' | 'jsonb' | null): string {
  const identifier = quoteMaintenanceIdentifier(column)
  const value = type === 'json' ? `${identifier}::text` : identifier
  const placeholder = type === 'jsonb' ? '?::jsonb' : '?'
  return `${value} IS NOT DISTINCT FROM ${placeholder}`
}

export async function* readMaintenanceBatches(
  connection: MaintenanceConnection,
  table: string,
  columns: string[] | MaintenanceColumnTypes,
  primaryKeys: string[],
  scope: MaintenanceScope,
  batchSize = MAINTENANCE_BATCH_SIZE,
  initialCursor?: string[] | null,
): AsyncGenerator<MaintenanceRow[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('[internal] Invalid maintenance batch size')
  if (!primaryKeys.length) throw new Error('[internal] Maintenance requires a complete primary key')
  const columnTypes = Array.isArray(columns) ? undefined : columns
  const names = [...new Set([...primaryKeys, ...(Array.isArray(columns) ? columns : columns.keys())])]
  const projection = names.map(quoteMaintenanceIdentifier).join(', ')
  const selected = names.map((name) => {
    const column = quoteMaintenanceIdentifier(name)
    const value = `maintenance_rows.${column}`
    return primaryKeys.includes(name) || columnTypes?.get(name) ? `${value}::text AS ${column}` : value
  }).join(', ')
  const keys = primaryKeys.map((key) => `maintenance_rows.${quoteMaintenanceIdentifier(key)}`)
  const scopeSql = 'tenant_id = ? AND organization_id IS NOT DISTINCT FROM ?'
  const scopeValues = [scope.tenantId, scope.organizationId]
  const oversized = await connection.execute(
    `SELECT 1 FROM ${table} WHERE ${scopeSql} AND octet_length(convert_to(jsonb_build_array(${projection})::text, 'UTF8')) > ? LIMIT 1`,
    [...scopeValues, MAINTENANCE_ROW_BYTES],
  )
  if (!Array.isArray(oversized)) throw new Error('[internal] Invalid maintenance size preflight')
  if (oversized.length) throw new Error('[internal] Maintenance row exceeds supported byte limit')
  if (initialCursor && (initialCursor.length !== primaryKeys.length || initialCursor.some(value => typeof value !== 'string' || Buffer.byteLength(value) > 8192))) throw new Error('[internal] Invalid maintenance resume cursor')
  let cursor: unknown[] | null = initialCursor ?? null
  for (;;) {
    const predicate = cursor ? ` AND (${keys.join(', ')}) > (${keys.map(() => '?').join(', ')})` : ''
    const result = await connection.execute(
      `SELECT ${selected} FROM ${table} AS maintenance_rows WHERE ${scopeSql}${predicate} ORDER BY ${keys.join(', ')} LIMIT ${batchSize}`,
      [...scopeValues, ...(cursor ?? [])],
    )
    if (!Array.isArray(result)) throw new Error('[internal] Invalid maintenance batch')
    const rows = result as MaintenanceRow[]
    if (!rows.length) return
    const next = primaryKeys.map((key) => rows[rows.length - 1]![key])
    if (next.some((value) => value == null)) throw new Error('[internal] Maintenance primary key is missing')
    if (cursor && next.every((value, index) => value === cursor![index])) throw new Error('[internal] Maintenance cursor did not advance')
    yield rows
    cursor = next
    if (rows.length < batchSize) return
  }
}

export async function writeMaintenanceRow(
  connection: MaintenanceConnection,
  table: string,
  primaryKeys: string[],
  row: MaintenanceRow,
  updates: MaintenanceRow,
  scope: MaintenanceScope,
  verifyPersisted = false,
  columnTypes?: MaintenanceColumnTypes,
): Promise<void> {
  const columns = Object.keys(updates)
  if (!columns.length) return
  const assignments = columns.map((column) => `${quoteMaintenanceIdentifier(column)} = ?`).join(', ')
  const identity = primaryKeys.map((key) => `${quoteMaintenanceIdentifier(key)} = ?`).join(' AND ')
  const unchanged = columns.map((column) => unchangedColumn(column, columnTypes?.get(column))).join(' AND ')
  const result = await connection.execute(
    `UPDATE ${table} SET ${assignments} WHERE ${identity} AND tenant_id = ? AND organization_id IS NOT DISTINCT FROM ? AND ${unchanged} RETURNING ${primaryKeys.map(quoteMaintenanceIdentifier).join(', ')}`,
    [...Object.values(updates), ...primaryKeys.map((key) => row[key]), scope.tenantId, scope.organizationId, ...columns.map((column) => row[column])],
  )
  if (!Array.isArray(result) || result.length !== 1) throw new Error('[internal] A row changed concurrently during encryption maintenance; stop writers before retrying')
  if (verifyPersisted) {
    const committed = await connection.execute(
      `SELECT ${primaryKeys.map(quoteMaintenanceIdentifier).join(', ')} FROM ${table} WHERE ${identity} AND tenant_id = ? AND organization_id IS NOT DISTINCT FROM ? AND ${unchanged}`,
      [...primaryKeys.map((key) => row[key]), scope.tenantId, scope.organizationId, ...Object.values(updates)],
    )
    if (!Array.isArray(committed) || committed.length !== 1) throw new Error('[internal] Persisted encryption maintenance readback did not match intended values')
  }
}

export async function verifyMaintenanceBatch(
  connection: MaintenanceConnection,
  table: string,
  primaryKeys: string[],
  writes: Array<{ row: MaintenanceRow; updates: MaintenanceRow }>,
  scope: MaintenanceScope,
  columnTypes?: MaintenanceColumnTypes,
): Promise<void> {
  if (!writes.length) return
  if (writes.length > 500 || !primaryKeys.length) throw new Error('[internal] Invalid maintenance readback batch')
  const parameters: unknown[] = [scope.tenantId, scope.organizationId]
  const identities = writes.map(({ row }) => {
    for (const key of primaryKeys) parameters.push(row[key])
    return `(${primaryKeys.map(() => '?').join(', ')})`
  })
  const keyTuple = `(${primaryKeys.map(quoteMaintenanceIdentifier).join(', ')})`
  const selected = [...new Set([...primaryKeys, ...writes.flatMap(({ updates }) => Object.keys(updates))])]
  const comparisons = writes.map(({ row, updates }) => {
    const identity = primaryKeys.map((key) => { parameters.push(row[key]); return `${quoteMaintenanceIdentifier(key)} = ?` })
    const values = Object.entries(updates).map(([key, value]) => { parameters.push(value); return unchangedColumn(key, columnTypes?.get(key)) })
    return `(${[...identity, ...values].join(' AND ')})`
  })
  if (parameters.length > 60000) throw new Error('[internal] Maintenance readback parameter bound exceeded')
  const result = await connection.execute(
    `WITH maintenance_readback AS MATERIALIZED (
      SELECT ${selected.map(quoteMaintenanceIdentifier).join(', ')} FROM ${table}
      WHERE tenant_id = ? AND organization_id IS NOT DISTINCT FROM ? AND ${keyTuple} IN (${identities.join(', ')})
    ) SELECT count(*)::text AS verified FROM maintenance_readback WHERE ${comparisons.join(' OR ')}`, parameters,
  )
  if (!Array.isArray(result) || result.length !== 1 || String((result[0] as { verified?: unknown }).verified) !== String(writes.length)) throw new Error('[internal] Persisted encryption maintenance batch did not match intended values')
}
