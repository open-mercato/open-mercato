import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { referenceTaskCreateSchema, referenceTaskLinkCreateSchema, type ReferenceScope } from '../data/validators'

export const REFERENCE_TASK_IMPORT_QUEUE = 'reference-module-task-import'
export const REFERENCE_IMPORT_MAX_BYTES = 2 * 1024 * 1024
export const REFERENCE_IMPORT_MAX_ROWS = 5_000

export const referenceImportHeaders = [
  'title',
  'description',
  'status',
  'priority',
  'dueAt',
  'isActive',
  'source',
  'targetKind',
  'targetId',
] as const

const importRowSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  dueAt: z.string().optional(),
  isActive: z.string().optional(),
  source: z.string().optional(),
  targetKind: z.string().optional(),
  targetId: z.string().optional(),
}).strict()

export type ReferenceTaskImportJobPayload = {
  progressJobId: string
  csv: string
  idempotencyKeyHash: string
  scope: ReferenceScope & { userId?: string | null }
}

export type ReferenceTaskImportSummary = {
  totalCount: number
  processedCount: number
  succeededCount: number
  failedCount: number
  skippedCount: number
  status: 'completed' | 'partial' | 'cancelled' | 'failed'
}

let importQueue: Queue<ReferenceTaskImportJobPayload> | null = null

export function getReferenceTaskImportQueue(): Queue<ReferenceTaskImportJobPayload> {
  if (!importQueue) importQueue = createModuleQueue<ReferenceTaskImportJobPayload>(REFERENCE_TASK_IMPORT_QUEUE, { concurrency: 3 })
  return importQueue
}

export function hashReferenceImportKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function referenceImportRowId(
  scope: ReferenceScope,
  idempotencyKeyHash: string,
  rowIndex: number,
): string {
  const hex = createHash('sha256')
    .update(`${scope.tenantId}:${scope.organizationId}:${idempotencyKeyHash}:${rowIndex}`)
    .digest('hex')
    .slice(0, 32)
    .split('')
  hex[12] = '4'
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

function parseCsvRecords(csv: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true
    } else if (character === ',') {
      record.push(field)
      field = ''
    } else if (character === '\n') {
      record.push(field.replace(/\r$/, ''))
      records.push(record)
      record = []
      field = ''
    } else {
      field += character
    }
  }
  if (quoted) throw new Error('[internal] Unterminated quoted CSV field')
  if (field.length > 0 || record.length > 0) {
    record.push(field.replace(/\r$/, ''))
    records.push(record)
  }
  return records.filter((entry) => entry.some((value) => value.length > 0))
}

export function parseReferenceImportCsv(csv: string): Array<Record<string, string>> {
  const records = parseCsvRecords(csv.replace(/^\uFEFF/, ''))
  if (records.length < 2) throw new Error('[internal] CSV must include a header and at least one data row')
  const headers = records[0]
  if (!headers.includes('title') || new Set(headers).size !== headers.length) {
    throw new Error('[internal] CSV requires a unique title header')
  }
  const allowed = new Set<string>(referenceImportHeaders)
  if (headers.some((header) => !allowed.has(header))) throw new Error('[internal] CSV contains an unknown header')
  const rows = records.slice(1)
  if (rows.length > REFERENCE_IMPORT_MAX_ROWS) throw new Error('[internal] CSV row limit exceeded')
  return rows.map((values) => {
    if (values.length !== headers.length) throw new Error('[internal] CSV row width does not match its header')
    return importRowSchema.parse(Object.fromEntries(headers.map((header, index) => [header, values[index]])))
  })
}

export function validateReferenceImportRow(row: Record<string, string>) {
  const target = row.targetKind || row.targetId
    ? referenceTaskLinkCreateSchema.parse({ targetKind: row.targetKind, targetId: row.targetId })
    : null
  const task = referenceTaskCreateSchema.parse({
    title: row.title,
    description: row.description || null,
    status: row.status || undefined,
    priority: row.priority ? Number(row.priority) : undefined,
    dueAt: row.dueAt || null,
    isActive: row.isActive ? z.enum(['true', 'false']).parse(row.isActive) === 'true' : undefined,
    customFields: row.source ? { source: row.source } : undefined,
  })
  return { task, target }
}

export function escapeReferenceCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value)
  const formulaSafe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/.test(formulaSafe) ? `"${formulaSafe.replace(/"/g, '""')}"` : formulaSafe
}
