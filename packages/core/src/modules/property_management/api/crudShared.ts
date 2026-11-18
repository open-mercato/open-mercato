import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityName } from '@mikro-orm/core'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  defaultCreateResponseSchema as sharedDefaultCreateResponseSchema,
  defaultOkResponseSchema as sharedDefaultOkResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { assertBuildingPermitted, NO_MATCH_ID, permittedBuildingIds, type PermittedBuildings } from '../lib/buildingAccess'
import type { Scope } from '../lib/productUse'
import type { CrmAccess } from '../lib/crmAccess'

export const { withScopedPayload, parseScopedCommandInput } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'property_management.errors.tenantRequired', fallback: 'Tenant context is required' },
    organizationRequired: { key: 'property_management.errors.organizationRequired', fallback: 'Organization context is required' },
  },
})

export const defaultCreateResponseSchema = sharedDefaultCreateResponseSchema
export const defaultOkResponseSchema = sharedDefaultOkResponseSchema

export function createPagedListResponseSchema(itemSchema: z.ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const buildCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Property Management',
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the buildings the caller may see.`,
})

export function createPropertyManagementCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildCrudOpenApi(options)
}

export const rawBodySchema = z.object({}).passthrough()

const SCOPE_KEYS = new Set(['tenantId', 'organizationId'])

export function unscopedDocSchema(schema: z.ZodObject<z.ZodRawShape>): z.ZodObject<z.ZodRawShape> {
  return z.object(Object.fromEntries(Object.entries(schema.shape).filter(([key]) => !SCOPE_KEYS.has(key))))
}

export function crudScope(ctx: CrudCtx): Scope | null {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) return null
  return { tenantId, organizationId }
}

export async function crudPermitted(ctx: CrudCtx): Promise<PermittedBuildings> {
  const scope = crudScope(ctx)
  return permittedBuildingIds({
    container: ctx.container,
    auth: ctx.auth,
    tenantId: scope?.tenantId ?? null,
    organizationId: scope?.organizationId ?? null,
    request: ctx.request ?? null,
  })
}

export function crudEm(ctx: CrudCtx): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

type BuildingScopedRecord = { id: string; tenantId: string; organizationId: string; buildingId: string }

export async function assertCrudBuildingAccess(ctx: CrudCtx, buildingId: string): Promise<void> {
  await assertBuildingPermitted(await crudPermitted(ctx), buildingId)
}

export async function assertCrudRecordBuildingAccess(
  ctx: CrudCtx,
  entity: EntityName<BuildingScopedRecord>,
  id: string,
): Promise<void> {
  const permitted = await crudPermitted(ctx)
  if (permitted === null) return
  const scope = crudScope(ctx)
  if (!scope) return
  const record = await findOneWithDecryption(crudEm(ctx), entity, { id, ...scope }, undefined, scope)
  if (record) await assertBuildingPermitted(permitted, record.buildingId)
}

function listOrganizationId(ctx: CrudCtx): string | null {
  const organizationId = crudScope(ctx)?.organizationId ?? null
  if (!organizationId) return null
  if (Array.isArray(ctx.organizationIds) && !ctx.organizationIds.includes(organizationId)) return null
  return organizationId
}

export function crudScopeFilters(ctx: CrudCtx): Record<string, unknown> {
  return {
    tenant_id: { $eq: ctx.auth?.tenantId ?? NO_MATCH_ID },
    organization_id: { $eq: listOrganizationId(ctx) ?? NO_MATCH_ID },
  }
}

export function sealListScope(scope: Record<string, unknown>, filters: Record<string, unknown>): Record<string, unknown> {
  const existing = Array.isArray(filters.$and) ? filters.$and : []
  return { ...filters, $and: [...existing, scope] }
}

export function restrictToBuildings(filters: Record<string, unknown>, field: string, permitted: PermittedBuildings): void {
  if (permitted === null) return
  filters[field] = { $in: permitted.length ? permitted : [NO_MATCH_ID] }
}

export function restrictBuildingField(
  filters: Record<string, unknown>,
  field: string,
  permitted: PermittedBuildings,
  requested?: string | null,
): void {
  if (requested) {
    filters[field] = permitted === null || permitted.includes(requested) ? { $eq: requested } : { $in: [NO_MATCH_ID] }
    return
  }
  restrictToBuildings(filters, field, permitted)
}

export function restrictIds(filters: Record<string, unknown>, id: unknown, permitted: PermittedBuildings | null, field: 'id' = 'id'): void {
  const requested = typeof id === 'string' && id.length ? id : null
  if (requested && permitted !== null) {
    filters[field] = { $in: permitted.includes(requested) ? [requested] : [NO_MATCH_ID] }
    return
  }
  if (requested) {
    filters[field] = { $eq: requested }
    return
  }
  if (permitted !== null) filters[field] = { $in: permitted.length ? permitted : [NO_MATCH_ID] }
}

export function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return null
}

export function readNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

export function readBoolean(record: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'boolean') return value
  }
  return false
}

export function readIso(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'string' && value.length) return value
  }
  return null
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export type ListPayload = { items?: unknown[] }

export function listItems(payload: unknown): Record<string, unknown>[] {
  const items = asRecord(payload).items
  return Array.isArray(items) ? items.map(asRecord) : []
}

export function attachCrmAccess(payload: unknown, crmAccess: CrmAccess): void {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) Object.assign(payload, { crmAccess })
}

export const crmAccessSchema = z
  .object({ people: z.boolean(), companies: z.boolean() })
  .describe('Which CRM data the caller may see: `people` = `customers.people.view`, `companies` = `customers.companies.view` (wildcard grants count)')

export function rectFields(record: Record<string, unknown>) {
  return {
    x: readNumber(record, 'x') ?? 0,
    y: readNumber(record, 'y') ?? 0,
    width: readNumber(record, 'width') ?? 0,
    depth: readNumber(record, 'depth') ?? 0,
  }
}

export const listQueryBase = {
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().max(200).optional(),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}
