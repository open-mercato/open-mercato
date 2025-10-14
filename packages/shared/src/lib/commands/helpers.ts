import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import type { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig, CrudEmitContext } from '@open-mercato/shared/lib/crud/types'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CommandLogMetadata } from '@open-mercato/shared/lib/commands'

export type ParsedPayload<TSchema extends z.ZodTypeAny> = {
  parsed: z.infer<TSchema>
  custom: Record<string, unknown>
}

export function parseWithCustomFields<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  raw: unknown
): ParsedPayload<TSchema> {
  const { base, custom } = splitCustomFieldPayload(raw)
  const parsed = schema.parse(base)
  return { parsed, custom }
}

export async function setCustomFieldsIfAny(opts: {
  dataEngine: DataEngine
  entityId: string
  recordId: string
  tenantId: string | null
  organizationId: string | null
  values: Record<string, unknown>
  notify?: boolean
}) {
  const { values } = opts
  if (!values || !Object.keys(values).length) return
  const { dataEngine, entityId, recordId, tenantId, organizationId, notify = false } = opts
  await dataEngine.setCustomFields({
    entityId,
    recordId,
    tenantId,
    organizationId,
    values,
    notify,
  })
}

export async function emitCrudSideEffects<TEntity>(opts: {
  dataEngine: DataEngine
  action: 'created' | 'updated' | 'deleted'
  entity: TEntity
  identifiers: CrudEmitContext<TEntity>['identifiers']
  events?: CrudEventsConfig<TEntity>
  indexer?: CrudIndexerConfig<TEntity>
}) {
  const { dataEngine, action, entity, identifiers, events, indexer } = opts
  await dataEngine.emitOrmEntityEvent({
    action,
    entity,
    identifiers,
    events,
    indexer,
  })
}

export function buildChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  keys: readonly string[]
): Record<string, { from: unknown; to: unknown }> {
  if (!before) return {}
  const diff: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of keys) {
    const prev = before[key]
    const next = after[key]
    if (prev !== next) diff[key] = { from: prev, to: next }
  }
  return diff
}

export function requireTenantScope(authTenantId: string | null, requested?: string | null): string {
  if (authTenantId && requested && requested !== authTenantId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
  const tenantId = requested || authTenantId
  if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant scope required' })
  return tenantId
}

export function requireId(value: unknown, message = 'ID is required'): string {
  if (typeof value === 'string' && value.trim()) return value
  if (value && typeof value === 'object') {
    const id =
      (value as any).id ??
      (value as any).recordId ??
      (value as any).body?.id ??
      (value as any).query?.id
    if (typeof id === 'string' && id.trim()) return id
    if (typeof id === 'number' || typeof id === 'bigint') return String(id)
  }
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  throw new CrudHttpError(400, { error: message })
}

export type LogBuilderArgs<TInput, TResult> = {
  input: TInput
  result: TResult
  ctx: CommandRuntimeContext
  snapshots: { before?: unknown }
}

export type LogBuilder<TInput, TResult> = (args: LogBuilderArgs<TInput, TResult>) => CommandLogMetadata | null | Promise<CommandLogMetadata | null>
