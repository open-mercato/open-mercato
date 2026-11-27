import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { createCrudOpenApiFactory } from '@open-mercato/shared/lib/openapi/crud'
import { documentFindingSeveritySchema } from '../data/validators'

export const buildDocumentsCrudOpenApi = createCrudOpenApiFactory({ defaultTag: 'Documents' })

export const reviewPlaybookMutationBodySchema = z.object({}).passthrough()

export function resolveCrudScope(ctx: CrudCtx): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId) throw new CrudHttpError(401, { error: 'api.errors.unauthorized' })
  if (!organizationId) throw new CrudHttpError(400, { error: 'documents.errors.organizationRequired' })
  return { tenantId, organizationId }
}

export function resolveCrudDeleteId(parsed: unknown, ctx: CrudCtx): string {
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const body = record.body && typeof record.body === 'object' ? record.body as Record<string, unknown> : {}
  const query = record.query && typeof record.query === 'object' ? record.query as Record<string, unknown> : {}
  const candidate = body.id ?? record.id ?? query.id
    ?? (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
  const parsedId = z.string().uuid().safeParse(candidate)
  if (!parsedId.success) throw new CrudHttpError(400, { error: 'documents.validation.common.invalidUuid' })
  return parsedId.data
}

export function readExpectedUpdatedAt(parsed: unknown): string | null {
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const body = record.body && typeof record.body === 'object' ? record.body as Record<string, unknown> : record
  const value = body.expectedUpdatedAt
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readString(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string') return value
    if (value instanceof Date) return value.toISOString()
  }
  return null
}

export function readTimestamp(row: Record<string, unknown>, ...keys: string[]): string | null {
  const value = readString(row, ...keys)
  if (value === null) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
}

function readNumber(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function readBoolean(row: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'boolean') return value
    if (value === 'true' || value === 't') return true
    if (value === 'false' || value === 'f') return false
  }
  return true
}

export const reviewPlaybookItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  instructions: z.string().nullable(),
  version: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const reviewRuleItemSchema = z.object({
  id: z.string().uuid(),
  playbookId: z.string().uuid(),
  code: z.string(),
  title: z.string(),
  topic: z.string().nullable(),
  position: z.string(),
  preferredWording: z.string().nullable(),
  severity: documentFindingSeveritySchema,
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export function toReviewPlaybookItem(row: Record<string, unknown>): z.infer<typeof reviewPlaybookItemSchema> {
  return {
    id: readString(row, 'id') ?? '',
    code: readString(row, 'code') ?? '',
    name: readString(row, 'name') ?? '',
    description: readString(row, 'description'),
    instructions: readString(row, 'instructions'),
    version: readNumber(row, 'version') ?? 1,
    isActive: readBoolean(row, 'is_active', 'isActive'),
    createdAt: readTimestamp(row, 'created_at', 'createdAt'),
    updatedAt: readTimestamp(row, 'updated_at', 'updatedAt'),
  }
}

export function toReviewRuleItem(row: Record<string, unknown>): z.infer<typeof reviewRuleItemSchema> {
  const severity = documentFindingSeveritySchema.safeParse(readString(row, 'severity'))
  return {
    id: readString(row, 'id') ?? '',
    playbookId: readString(row, 'playbook_id', 'playbookId') ?? '',
    code: readString(row, 'code') ?? '',
    title: readString(row, 'title') ?? '',
    topic: readString(row, 'topic'),
    position: readString(row, 'position') ?? '',
    preferredWording: readString(row, 'preferred_wording', 'preferredWording'),
    severity: severity.success ? severity.data : 'warning',
    sortOrder: readNumber(row, 'sort_order', 'sortOrder') ?? 0,
    isActive: readBoolean(row, 'is_active', 'isActive'),
    createdAt: readTimestamp(row, 'created_at', 'createdAt'),
    updatedAt: readTimestamp(row, 'updated_at', 'updatedAt'),
  }
}

export const reviewMutationResponseSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string(),
})
