import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  open,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import { listEntityMetadata } from '@open-mercato/shared/lib/db/entityMetadata'
import { resolveEntityIdFromMetadata } from '@open-mercato/shared/lib/encryption/entityIds'
import { decryptCustomFieldValue } from '@open-mercato/shared/lib/encryption/customFieldValues'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { getTenantExportExclusion } from '@open-mercato/shared/lib/privacy'

export const TENANT_EXIT_EXPORT_FORMAT = 'open-mercato.tenant-exit'
export const TENANT_EXIT_EXPORT_VERSION = 1
const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const ENCRYPTED_VALUE_PATTERN = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*:[A-Za-z0-9+/=]+:v1$/

type SqlRow = Record<string, unknown>

type SqlExecutor = {
  execute<T>(sql: string, params?: unknown[]): Promise<T>
}

type ExportStorageDriver = {
  read(partitionCode: string, storagePath: string): Promise<{ buffer: Buffer }>
}

type ExportStorageDriverFactory = {
  resolveForPartition(
    partitionCode: string,
    scope: { tenantId: string; organizationId: string },
  ): Promise<ExportStorageDriver>
}

type TableSchema = {
  columns: string[]
  primaryKey: string[]
}

type ForeignKey = {
  childColumn: string
  childTable: string
  parentColumn: string
  parentTable: string
}

type TableSelection = {
  params: unknown[]
  where: string
}

type ExportedFile = {
  bytes: number
  path: string
  sha256: string
}

type ExportedTable = ExportedFile & {
  entityId: string | null
  name: string
  redactedColumns: string[]
  rows: number
}

type AttachmentRow = {
  fileName: string
  fileSize: number | null
  id: string
  organizationId: string
  partitionCode: string
  storagePath: string
  tenantId: string
}

type ExportedAttachment = ExportedFile & {
  id: string
  sourceFileName: string
}

type MissingAttachment = {
  id: string
  reason: string
  sourceFileName: string
}

type ExcludedTable = {
  module?: string
  name: string
  reason: 'authentication-or-runtime-secret' | 'no-tenant-scope-or-relation' | 'unsupported-relational-key'
}

export type TenantExitExportInput = {
  actor: string
  allowMissingAttachments?: boolean
  outputPath: string
  tenantId: string
}

export type TenantExitExportResult = {
  attachmentCount: number
  missingAttachmentCount: number
  outputPath: string
  rowCount: number
  tableCount: number
}

type TenantExitExportDependencies = {
  archiveWriter?: (sourceDir: string, archivePath: string) => Promise<void>
  em: EntityManager
  now?: () => Date
  storageDriverFactory?: ExportStorageDriverFactory | null
  tenantEncryptionService?: TenantDataEncryptionService | null
}

type ColumnRow = {
  column_name: string
  table_name: string
}

type PrimaryKeyRow = ColumnRow & {
  ordinal_position: number
}

type ForeignKeyRow = {
  child_column: string
  child_table: string
  constraint_name: string
  parent_column: string
  parent_table: string
}

type IdRow = {
  id: string
}

type CustomFieldKindRow = {
  entity_id: string
  field_key: string
  kind: string
  organization_id: string | null
  tenant_id: string | null
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) throw new Error(`[internal] Unsafe database identifier: ${value}`)
  return `"${value}"`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeTenantExportValue(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return null
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return { encoding: 'base64', value: value.toString('base64') }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('[internal] Tenant export contains a circular value')
    seen.add(value)
    const normalized = value.map((item) => normalizeTenantExportValue(item, seen))
    seen.delete(value)
    return normalized
  }
  if (!isRecord(value)) return String(value)
  if (seen.has(value)) throw new Error('[internal] Tenant export contains a circular value')
  seen.add(value)
  const normalized: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) {
    if (value[key] !== undefined) normalized[key] = normalizeTenantExportValue(value[key], seen)
  }
  seen.delete(value)
  return normalized
}

export function isSensitiveTenantExportColumn(column: string): boolean {
  const normalized = column.toLowerCase()
  if (normalized === 'credentials' || normalized === 'credential') return true
  if (normalized.includes('password')) return true
  if (normalized.includes('secret')) return true
  if (normalized.includes('credential')) return true
  if (normalized.includes('private_key')) return true
  if (normalized.includes('recovery_code')) return true
  return /(^|_)token($|_)/.test(normalized)
}

export function sanitizeTenantExportFileName(fileName: string): string {
  const safe = basename(fileName)
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180)
  return safe || 'attachment.bin'
}

export function buildTenantTableSelection(
  tableName: string,
  schema: TableSchema,
  tenantId: string,
  organizationIds: string[],
): TableSelection | null {
  if (tableName === 'tenants' && schema.columns.includes('id')) {
    return { where: '"id" = ?', params: [tenantId] }
  }
  const hasTenant = schema.columns.includes('tenant_id')
  const hasOrganization = schema.columns.includes('organization_id')
  if (hasTenant && hasOrganization && organizationIds.length > 0) {
    return {
      where: '("tenant_id" = ? OR ("tenant_id" IS NULL AND "organization_id"::text = ANY(?::text[])))',
      params: [tenantId, organizationIds],
    }
  }
  if (hasTenant) return { where: '"tenant_id" = ?', params: [tenantId] }
  if (hasOrganization && organizationIds.length > 0) {
    return { where: '"organization_id"::text = ANY(?::text[])', params: [organizationIds] }
  }
  return null
}

function redactSensitiveColumns(row: SqlRow): { row: SqlRow; redacted: string[] } {
  const sanitized: SqlRow = { ...row }
  const redacted: string[] = []
  for (const column of Object.keys(sanitized)) {
    if (!isSensitiveTenantExportColumn(column)) continue
    if (sanitized[column] !== null && sanitized[column] !== undefined) redacted.push(column)
    sanitized[column] = null
  }
  return { row: sanitized, redacted }
}

function asText(value: unknown): string | null {
  if (typeof value === 'string' && value) return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return null
}

function containsEncryptedTenantValue(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === 'string') return ENCRYPTED_VALUE_PATTERN.test(value)
  if (!value || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  const result = Array.isArray(value)
    ? value.some((item) => containsEncryptedTenantValue(item, seen))
    : Object.values(value as Record<string, unknown>).some((item) => containsEncryptedTenantValue(item, seen))
  seen.delete(value)
  return result
}

function formatCustomFieldKindKey(entityId: string, fieldKey: string, tenantId: string | null, organizationId: string | null): string {
  return `${entityId}\u0000${fieldKey}\u0000${tenantId ?? '*'}\u0000${organizationId ?? '*'}`
}

async function sha256File(filePath: string): Promise<ExportedFile> {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  const fileStat = await stat(filePath)
  return { bytes: fileStat.size, path: filePath, sha256: hash.digest('hex') }
}

async function defaultArchiveWriter(sourceDir: string, archivePath: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('tar', ['-czf', archivePath, '-C', sourceDir, '.'], {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`[internal] tar failed with code ${code ?? 'unknown'}: ${stderr.trim()}`))
    })
  })
}

async function writeJsonLines(filePath: string, rows: SqlRow[]): Promise<void> {
  const handle = await open(filePath, 'wx', 0o600)
  try {
    for (const row of rows) {
      await handle.write(`${JSON.stringify(normalizeTenantExportValue(row))}\n`)
    }
  } finally {
    await handle.close()
  }
}

function tableOrder(schema: TableSchema): string {
  const columns = schema.primaryKey.length > 0 ? schema.primaryKey : ['ctid']
  return columns.map((column) => column === 'ctid' ? 'ctid' : quoteIdentifier(column)).join(', ')
}

function selectionForRelatedIds(schema: TableSchema, ids: string[]): TableSelection | null {
  if (schema.primaryKey.length !== 1 || ids.length === 0) return null
  const primaryKey = quoteIdentifier(schema.primaryKey[0])
  return { where: `${primaryKey}::text = ANY(?::text[])`, params: [ids] }
}

function relativeExportPath(packageRoot: string, path: string): string {
  return relative(packageRoot, path).split('\\').join('/')
}

export class TenantExitExportService {
  private readonly archiveWriter: (sourceDir: string, archivePath: string) => Promise<void>
  private readonly now: () => Date

  constructor(private readonly dependencies: TenantExitExportDependencies) {
    this.archiveWriter = dependencies.archiveWriter ?? defaultArchiveWriter
    this.now = dependencies.now ?? (() => new Date())
  }

  async export(input: TenantExitExportInput): Promise<TenantExitExportResult> {
    const outputPath = input.outputPath
    await mkdir(dirname(outputPath), { recursive: true })
    const stagingRoot = await mkdtemp(join(dirname(outputPath), '.om-tenant-export-'))
    await chmod(stagingRoot, 0o700)
    const packageRoot = join(stagingRoot, 'package')
    const archivePath = join(stagingRoot, 'package.tar.gz')

    try {
      await mkdir(join(packageRoot, 'tables'), { recursive: true, mode: 0o700 })
      await mkdir(join(packageRoot, 'attachments'), { recursive: true, mode: 0o700 })
      const generatedAt = this.now().toISOString()
      const snapshot = await this.dependencies.em.transactional(async (transactionalEm) => {
        const connection = transactionalEm.getConnection() as unknown as SqlExecutor
        await connection.execute('set transaction isolation level repeatable read, read only')
        return this.exportDatabaseSnapshot(connection, transactionalEm, packageRoot, input)
      })
      const attachments = await this.exportAttachments(packageRoot, snapshot.attachmentRows, input)
      const readmePath = join(packageRoot, 'README.txt')
      await writeFile(
        readmePath,
        [
          'Open Mercato tenant exit package',
          '',
          'This package contains decrypted customer data and must be treated as confidential.',
          'It is not encrypted by Open Mercato. Store and transfer it only through operator-approved encrypted channels.',
          'Table data is stored as UTF-8 JSON Lines under tables/. Attachment binaries are stored under attachments/.',
          'See manifest.json for scope, counts, exclusions, redactions, exceptions, and SHA-256 checksums.',
          '',
        ].join('\n'),
        { encoding: 'utf8', mode: 0o600 },
      )
      const readmeFile = await sha256File(readmePath)
      const manifest = {
        format: TENANT_EXIT_EXPORT_FORMAT,
        version: TENANT_EXIT_EXPORT_VERSION,
        generatedAt,
        scope: { tenantId: input.tenantId },
        actor: input.actor,
        confidentiality: {
          archiveEncrypted: false,
          fileMode: '0600',
          handling: 'confidential-customer-data',
        },
        consistency: {
          database: 'repeatable-read',
          attachments: 'verified-after-database-snapshot',
        },
        tables: snapshot.tables,
        attachments: attachments.exported,
        missingAttachments: attachments.missing,
        excludedTables: snapshot.excludedTables,
        files: [
          {
            bytes: readmeFile.bytes,
            path: relativeExportPath(packageRoot, readmePath),
            sha256: readmeFile.sha256,
          },
        ],
      }
      await writeFile(join(packageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      await this.archiveWriter(packageRoot, archivePath)
      await chmod(archivePath, 0o600)
      await link(archivePath, outputPath)

      return {
        attachmentCount: attachments.exported.length,
        missingAttachmentCount: attachments.missing.length,
        outputPath,
        rowCount: snapshot.tables.reduce((total, table) => total + table.rows, 0),
        tableCount: snapshot.tables.length,
      }
    } finally {
      await rm(stagingRoot, { force: true, recursive: true })
    }
  }

  private async exportDatabaseSnapshot(
    connection: SqlExecutor,
    em: EntityManager,
    packageRoot: string,
    input: TenantExitExportInput,
  ): Promise<{
    attachmentRows: AttachmentRow[]
    excludedTables: ExcludedTable[]
    tables: ExportedTable[]
  }> {
    const tenant = await connection.execute<IdRow[]>('select "id"::text as "id" from "tenants" where "id" = ? limit 1', [input.tenantId])
    if (tenant.length !== 1) throw new Error('[internal] Tenant does not exist')

    const organizationRows = await connection.execute<IdRow[]>(
      'select "id"::text as "id" from "organizations" where "tenant_id" = ? order by "id"',
      [input.tenantId],
    )
    const organizationIds = organizationRows.map((row) => row.id)
    const { schemas, foreignKeys } = await this.loadSchema(connection)
    const directSelections = new Map<string, TableSelection>()
    const excludedTables: ExcludedTable[] = []

    for (const [tableName, schema] of schemas) {
      const exclusion = getTenantExportExclusion(tableName)
      if (exclusion) {
        excludedTables.push({ module: exclusion.module, name: tableName, reason: exclusion.reason })
        continue
      }
      const selection = buildTenantTableSelection(tableName, schema, input.tenantId, organizationIds)
      if (selection) directSelections.set(tableName, selection)
    }

    const relatedIds = await this.resolveRelatedRows(connection, schemas, foreignKeys, directSelections)
    const entityIds = this.resolveTableEntityIds(em)
    const customFieldKinds = schemas.has('custom_field_defs')
      ? await this.loadCustomFieldKinds(connection, input.tenantId, organizationIds)
      : new Map<string, string>()
    const attachmentRows: AttachmentRow[] = []
    const exportedTables: ExportedTable[] = []

    for (const tableName of Array.from(schemas.keys()).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) {
      if (getTenantExportExclusion(tableName)) continue
      const schema = schemas.get(tableName)
      if (!schema) continue
      const direct = directSelections.get(tableName)
      const related = selectionForRelatedIds(schema, Array.from(relatedIds.get(tableName) ?? []))
      const selection = direct ?? related
      if (!selection) {
        excludedTables.push({
          name: tableName,
          reason: relatedIds.has(tableName) ? 'unsupported-relational-key' : 'no-tenant-scope-or-relation',
        })
        continue
      }

      const rows = await connection.execute<SqlRow[]>(
        `select * from ${quoteIdentifier(tableName)} where ${selection.where} order by ${tableOrder(schema)}`,
        selection.params,
      )
      if (rows.length === 0) continue
      const entityId = entityIds.get(tableName) ?? null
      const redactedColumns = new Set<string>()
      const outputRows: SqlRow[] = []

      for (const sourceRow of rows) {
        this.validateForeignKeyScope(sourceRow, tableName, foreignKeys, directSelections, relatedIds)
        let row = await this.decryptRow(sourceRow, tableName, entityId, customFieldKinds, input.tenantId)
        const redacted = redactSensitiveColumns(row)
        row = redacted.row
        redacted.redacted.forEach((column) => redactedColumns.add(column))
        outputRows.push(row)
        if (tableName === 'attachments') attachmentRows.push(this.parseAttachmentRow(sourceRow, input.tenantId))
      }

      const tablePath = join(packageRoot, 'tables', `${tableName}.jsonl`)
      await writeJsonLines(tablePath, outputRows)
      const file = await sha256File(tablePath)
      exportedTables.push({
        bytes: file.bytes,
        entityId,
        name: tableName,
        path: relativeExportPath(packageRoot, tablePath),
        redactedColumns: Array.from(redactedColumns)
          .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
        rows: outputRows.length,
        sha256: file.sha256,
      })
    }

    return {
      attachmentRows,
      excludedTables: excludedTables.sort((left, right) => left.name.localeCompare(right.name)),
      tables: exportedTables,
    }
  }

  private async loadSchema(connection: SqlExecutor): Promise<{
    foreignKeys: ForeignKey[]
    schemas: Map<string, TableSchema>
  }> {
    const columns = await connection.execute<ColumnRow[]>(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = 'public'
       order by table_name, ordinal_position`,
    )
    const primaryKeys = await connection.execute<PrimaryKeyRow[]>(
      `select kcu.table_name, kcu.column_name, kcu.ordinal_position
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
       where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'
       order by kcu.table_name, kcu.ordinal_position`,
    )
    const foreignKeyRows = await connection.execute<ForeignKeyRow[]>(
      `select tc.constraint_name,
              tc.table_name as child_table,
              kcu.column_name as child_column,
              ccu.table_name as parent_table,
              ccu.column_name as parent_column
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
       join information_schema.constraint_column_usage ccu
         on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
       where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
       order by tc.table_name, tc.constraint_name, kcu.ordinal_position`,
    )
    const schemas = new Map<string, TableSchema>()
    for (const column of columns) {
      const current = schemas.get(column.table_name) ?? { columns: [], primaryKey: [] }
      current.columns.push(column.column_name)
      schemas.set(column.table_name, current)
    }
    for (const primaryKey of primaryKeys) {
      const current = schemas.get(primaryKey.table_name)
      if (current) current.primaryKey.push(primaryKey.column_name)
    }
    const constraintCounts = new Map<string, number>()
    for (const row of foreignKeyRows) {
      constraintCounts.set(row.constraint_name, (constraintCounts.get(row.constraint_name) ?? 0) + 1)
    }
    const foreignKeys = foreignKeyRows
      .filter((row) => constraintCounts.get(row.constraint_name) === 1)
      .map((row) => ({
        childColumn: row.child_column,
        childTable: row.child_table,
        parentColumn: row.parent_column,
        parentTable: row.parent_table,
      }))
    return { foreignKeys, schemas }
  }

  private async resolveRelatedRows(
    connection: SqlExecutor,
    schemas: Map<string, TableSchema>,
    foreignKeys: ForeignKey[],
    directSelections: Map<string, TableSelection>,
  ): Promise<Map<string, Set<string>>> {
    const selected = new Map<string, Set<string>>()
    for (const [tableName, selection] of directSelections) {
      const schema = schemas.get(tableName)
      if (!schema || schema.primaryKey.length !== 1) continue
      const primaryKey = quoteIdentifier(schema.primaryKey[0])
      const rows = await connection.execute<IdRow[]>(
        `select ${primaryKey}::text as "id" from ${quoteIdentifier(tableName)} where ${selection.where}`,
        selection.params,
      )
      selected.set(tableName, new Set(rows.map((row) => row.id)))
    }

    let changed = true
    while (changed) {
      changed = false
      for (const foreignKey of foreignKeys) {
        if (getTenantExportExclusion(foreignKey.childTable)) continue
        if (directSelections.has(foreignKey.childTable)) continue
        const parentIds = selected.get(foreignKey.parentTable)
        const childSchema = schemas.get(foreignKey.childTable)
        if (!parentIds?.size || !childSchema || childSchema.primaryKey.length !== 1) continue
        const rows = await connection.execute<IdRow[]>(
          `select distinct ${quoteIdentifier(childSchema.primaryKey[0])}::text as "id"
           from ${quoteIdentifier(foreignKey.childTable)}
           where ${quoteIdentifier(foreignKey.childColumn)}::text = ANY(?::text[])`,
          [Array.from(parentIds)],
        )
        const childIds = selected.get(foreignKey.childTable) ?? new Set<string>()
        const previousSize = childIds.size
        rows.forEach((row) => childIds.add(row.id))
        selected.set(foreignKey.childTable, childIds)
        if (childIds.size !== previousSize) changed = true
      }
    }
    return selected
  }

  private resolveTableEntityIds(em: EntityManager): Map<string, string> {
    const result = new Map<string, string>()
    for (const metadata of listEntityMetadata(em)) {
      const tableName = metadata.tableName ?? metadata.collection
      const entityId = resolveEntityIdFromMetadata(metadata)
      if (tableName && entityId) result.set(tableName, entityId)
    }
    return result
  }

  private async loadCustomFieldKinds(
    connection: SqlExecutor,
    tenantId: string,
    organizationIds: string[],
  ): Promise<Map<string, string>> {
    const rows = await connection.execute<CustomFieldKindRow[]>(
      `select "entity_id", "key" as "field_key", "kind", "tenant_id"::text, "organization_id"::text
       from "custom_field_defs"
       where "tenant_id" = ?
          or "organization_id"::text = ANY(?::text[])
          or ("tenant_id" is null and "organization_id" is null)`,
      [tenantId, organizationIds],
    )
    const result = new Map<string, string>()
    rows.forEach((row) => {
      result.set(formatCustomFieldKindKey(row.entity_id, row.field_key, row.tenant_id, row.organization_id), row.kind)
    })
    return result
  }

  private async decryptRow(
    sourceRow: SqlRow,
    tableName: string,
    entityId: string | null,
    customFieldKinds: Map<string, string>,
    fallbackTenantId: string,
  ): Promise<SqlRow> {
    const encryption = this.dependencies.tenantEncryptionService
    const tenantId = asText(sourceRow.tenant_id) ?? fallbackTenantId
    const organizationId = asText(sourceRow.organization_id)
    let row = { ...sourceRow }

    if (tableName === 'custom_entities_storage' && isRecord(row.doc)) {
      const dynamicEntityId = asText(row.entity_type)
      if (dynamicEntityId) row.doc = await this.decryptEntityPayload(dynamicEntityId, row.doc, tenantId, organizationId)
    } else if (entityId) {
      row = await this.decryptEntityPayload(entityId, row, tenantId, organizationId)
    }

    if (tableName === 'custom_field_values') {
      const valueColumns = ['value_text', 'value_multiline', 'value_int', 'value_float', 'value_bool']
      const entity = asText(row.entity_id)
      const field = asText(row.field_key)
      if (entity && field) {
        const kind = customFieldKinds.get(formatCustomFieldKindKey(entity, field, tenantId, organizationId))
          ?? customFieldKinds.get(formatCustomFieldKindKey(entity, field, tenantId, null))
          ?? customFieldKinds.get(formatCustomFieldKindKey(entity, field, null, organizationId))
          ?? customFieldKinds.get(formatCustomFieldKindKey(entity, field, null, null))
          ?? null
        for (const column of valueColumns) {
          const original = row[column]
          const decrypted = await decryptCustomFieldValue(original, tenantId, encryption ?? null, undefined, { kind })
          if (typeof original === 'string' && ENCRYPTED_VALUE_PATTERN.test(original) && decrypted === original) {
            throw new Error(`[internal] Unable to decrypt custom field value ${entity}.${field}`)
          }
          row[column] = decrypted
        }
      }
    }
    if (containsEncryptedTenantValue(row)) {
      throw new Error(`[internal] Export still contains encrypted application data in ${tableName}`)
    }
    return row
  }

  private async decryptEntityPayload(
    entityId: string,
    payload: SqlRow,
    tenantId: string,
    organizationId: string | null,
  ): Promise<SqlRow> {
    const encryption = this.dependencies.tenantEncryptionService
    if (!encryption) return payload
    const encryptedFields = await encryption.getEncryptedFieldNames(entityId, tenantId, organizationId, {
      ignoreRuntimeHealth: true,
    })
    if (encryptedFields.length > 0 && !encryption.isEnabled()) {
      throw new Error(`[internal] Encryption keys are unavailable for ${entityId}`)
    }
    return encryption.decryptEntityPayload(entityId, payload, tenantId, organizationId)
  }

  private validateForeignKeyScope(
    row: SqlRow,
    tableName: string,
    foreignKeys: ForeignKey[],
    directSelections: Map<string, TableSelection>,
    relatedIds: Map<string, Set<string>>,
  ): void {
    for (const foreignKey of foreignKeys) {
      if (foreignKey.childTable !== tableName || foreignKey.parentColumn !== 'id') continue
      if (!directSelections.has(foreignKey.parentTable)) continue
      const reference = asText(row[foreignKey.childColumn])
      if (!reference) continue
      const allowed = relatedIds.get(foreignKey.parentTable)
      if (allowed && !allowed.has(reference)) {
        throw new Error(`[internal] Cross-scope reference detected in ${tableName}.${foreignKey.childColumn}`)
      }
    }
  }

  private parseAttachmentRow(row: SqlRow, fallbackTenantId: string): AttachmentRow {
    const id = asText(row.id)
    const fileName = asText(row.file_name)
    const partitionCode = asText(row.partition_code)
    const storagePath = asText(row.storage_path)
    const organizationId = asText(row.organization_id)
    if (!id || !fileName || !partitionCode || !storagePath || !organizationId) {
      throw new Error('[internal] Attachment metadata is incomplete')
    }
    const rawSize = row.file_size
    const fileSize = typeof rawSize === 'number' && Number.isFinite(rawSize) ? rawSize : null
    return {
      fileName,
      fileSize,
      id,
      organizationId,
      partitionCode,
      storagePath,
      tenantId: asText(row.tenant_id) ?? fallbackTenantId,
    }
  }

  private async exportAttachments(
    packageRoot: string,
    attachmentRows: AttachmentRow[],
    input: TenantExitExportInput,
  ): Promise<{ exported: ExportedAttachment[]; missing: MissingAttachment[] }> {
    const exported: ExportedAttachment[] = []
    const missing: MissingAttachment[] = []
    for (const attachment of attachmentRows) {
      try {
        const storageFactory = this.dependencies.storageDriverFactory
        if (!storageFactory) throw new Error('Attachment storage driver is unavailable')
        const driver = await storageFactory.resolveForPartition(attachment.partitionCode, {
          organizationId: attachment.organizationId,
          tenantId: attachment.tenantId,
        })
        const result = await driver.read(attachment.partitionCode, attachment.storagePath)
        if (attachment.fileSize !== null && attachment.fileSize !== result.buffer.length) {
          throw new Error(`Attachment size mismatch: expected ${attachment.fileSize}, got ${result.buffer.length}`)
        }
        const attachmentDir = join(packageRoot, 'attachments', attachment.id)
        await mkdir(attachmentDir, { recursive: true, mode: 0o700 })
        const filePath = join(attachmentDir, sanitizeTenantExportFileName(attachment.fileName))
        await writeFile(filePath, result.buffer, { mode: 0o600 })
        const file = await sha256File(filePath)
        exported.push({
          bytes: file.bytes,
          id: attachment.id,
          path: relativeExportPath(packageRoot, filePath),
          sha256: file.sha256,
          sourceFileName: attachment.fileName,
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        if (!input.allowMissingAttachments) {
          throw new Error(`[internal] Failed to export attachment ${attachment.id}: ${reason}`)
        }
        missing.push({ id: attachment.id, reason, sourceFileName: attachment.fileName })
      }
    }
    return { exported, missing }
  }
}
