import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { CustomerGroup } from '../../data/entities'
import {
  customerGroupCreateSchema,
  customerGroupUpdateSchema,
  type CustomerGroupCreateInput,
  type CustomerGroupUpdateInput,
} from '../../data/validators'

// Shared (non-route) module: `route.ts` delegates to this single `makeCrudRoute`
// instance (GET/POST/PUT/DELETE all from one file — no `[id]` dynamic segment, see
// `route.ts`'s own comment) so the list projection, filters, and write mapping stay
// in one place. Next.js route auto-discovery only picks up `route.ts` files, so this
// file is invisible to it.

const rawBodySchema = z.object({}).passthrough()
type RawCustomerGroupInput = z.infer<typeof rawBodySchema>

export const customerGroupListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    search: z.string().optional(),
    kind: z.string().optional(),
    parentId: z.string().uuid().optional(),
    isActive: z.string().optional(),
    isDefault: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

export type CustomerGroupListQuery = z.infer<typeof customerGroupListQuerySchema>

export const customerGroupRouteMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customer_groups.groups.view'] },
  POST: { requireAuth: true, requireFeatures: ['customer_groups.groups.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customer_groups.groups.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customer_groups.groups.manage'] },
}

// Groups are tenant-scoped, not organization-scoped (see the doc comment on
// `CustomerGroup.organizationId` in `data/entities.ts`, which mirrors `CatalogPriceKind`
// — `packages/core/src/modules/catalog/data/entities.ts`). A write still records whatever
// organization is selected (mirroring `catalog/commands/priceKinds.ts` via
// `parseScopedCommandInput(..., { requireOrganization: false })`) so a future
// per-organization private-group phase has real data to scope by, but nothing downstream
// filters reads on it while `orm.orgField` below stays `null`.
function scopeFromContext(ctx: CrudCtx): { tenantId: string; organizationId?: string | null } {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) {
    throw new CrudHttpError(400, { error: '[internal] customer group scope is missing a tenant id' })
  }
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  return { tenantId, organizationId }
}

function parseCreateInput(input: RawCustomerGroupInput, ctx: CrudCtx): CustomerGroupCreateInput {
  return customerGroupCreateSchema.parse({ ...input, ...scopeFromContext(ctx) })
}

function parseUpdateInput(input: RawCustomerGroupInput, ctx: CrudCtx): CustomerGroupUpdateInput {
  return customerGroupUpdateSchema.parse({ ...input, ...scopeFromContext(ctx) })
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function toCustomerGroupEntityData(input: CustomerGroupCreateInput): Record<string, unknown> {
  return {
    organizationId: input.organizationId ?? null,
    tenantId: input.tenantId,
    code: input.code,
    name: input.name,
    description: input.description ?? null,
    kind: input.kind,
    parentId: input.parentId ?? null,
    priority: input.priority,
    isDefault: input.isDefault ?? false,
    isActive: input.isActive ?? true,
    metadata: input.metadata ?? null,
  }
}

// Scope fields (tenantId/organizationId) are deliberately excluded here — a group's
// tenant/organization is set once at creation and MUST NOT change on update.
function applyCustomerGroupUpdate(entity: CustomerGroup, input: CustomerGroupUpdateInput): void {
  if (hasOwn(input, 'code') && input.code) entity.code = input.code
  if (hasOwn(input, 'name') && input.name) entity.name = input.name
  if (hasOwn(input, 'description')) entity.description = input.description ?? null
  if (hasOwn(input, 'kind') && input.kind) entity.kind = input.kind
  if (hasOwn(input, 'parentId')) entity.parentId = input.parentId ?? null
  if (hasOwn(input, 'priority') && input.priority !== undefined) entity.priority = input.priority
  if (hasOwn(input, 'isDefault') && input.isDefault !== undefined) entity.isDefault = input.isDefault
  if (hasOwn(input, 'isActive') && input.isActive !== undefined) entity.isActive = input.isActive
  if (hasOwn(input, 'metadata')) entity.metadata = input.metadata ?? null
}

// "At most one is_default per tenant" (spec §5.1) has a DB-level backstop (the
// partial unique index `customer_groups_tenant_default_unique` in data/entities.ts)
// but that only throws a raw unique-violation on conflict — it does not implement
// the spec's actual UX ("enabling this will replace it"). Clear-and-set semantics:
// before saving a row with `isDefault: true`, unset every other default group for
// the tenant in one bulk statement, so the new default always wins cleanly instead
// of racing the unique index.
export async function clearOtherDefaultGroups(em: EntityManager, tenantId: string, excludeId?: string): Promise<void> {
  const where: Record<string, unknown> = { tenantId, isDefault: true, deletedAt: null }
  if (excludeId) where.id = { $ne: excludeId }
  await em.nativeUpdate(CustomerGroup, where, { isDefault: false })
}

const customerGroupListFields = [
  'id',
  'organization_id',
  'tenant_id',
  'code',
  'name',
  'description',
  'kind',
  'parent_id',
  'priority',
  'is_default',
  'is_active',
  'metadata',
  'created_at',
  'updated_at',
]

export const customerGroupCrud = makeCrudRoute<RawCustomerGroupInput, RawCustomerGroupInput, CustomerGroupListQuery>({
  metadata: customerGroupRouteMetadata,
  orm: {
    entity: CustomerGroup,
    idField: 'id',
    // `organization_id` is a nullable column (mirrors `CatalogPriceKind`), but groups are
    // tenant-scoped, not organization-scoped — `orgField: null` disables the CRUD
    // factory's organization filter/requirement entirely, exactly like
    // `catalog/api/price-kinds/route.ts`.
    orgField: null,
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  // No `E.customer_groups.*` entry exists yet — this module has no `ce.ts` custom-entity
  // declaration, so `yarn mercato generate entity-ids` has never emitted one. The string
  // literal form is the established fallback for a freshly-scaffolded module (mirrors
  // `staff/api/timesheets/time-projects/[id]/employees/route.ts`'s
  // `'staff:staff_time_project_member'`).
  indexer: { entityType: 'customer_groups:customer_group' },
  list: {
    schema: customerGroupListQuerySchema,
    entityId: 'customer_groups:customer_group',
    fields: customerGroupListFields,
    sortFieldMap: {
      priority: 'priority',
      name: 'name',
      code: 'code',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.search) {
        const pattern = buildIlikeTerm(query.search)
        filters.$or = [{ code: { $ilike: pattern } }, { name: { $ilike: pattern } }]
      }
      if (query.kind) filters.kind = { $eq: query.kind }
      if (query.parentId) filters.parent_id = { $eq: query.parentId }
      const isActive = parseBooleanToken(query.isActive)
      if (isActive !== null) filters.is_active = { $eq: isActive }
      const isDefault = parseBooleanToken(query.isDefault)
      if (isDefault !== null) filters.is_default = { $eq: isDefault }
      return filters
    },
  },
  create: {
    schema: rawBodySchema,
    mapToEntity: (input, ctx) => toCustomerGroupEntityData(parseCreateInput(input, ctx)),
  },
  update: {
    schema: rawBodySchema,
    getId: (input) => (typeof input.id === 'string' ? input.id : ''),
    applyToEntity: (entity, input, ctx) => {
      applyCustomerGroupUpdate(entity as CustomerGroup, parseUpdateInput(input, ctx))
    },
    response: () => ({ ok: true }),
  },
  del: { idFrom: 'query', softDelete: true, response: () => ({ ok: true }) },
  hooks: {
    // Raw JSON bodies carry `isDefault` as an actual boolean (not a query-string
    // token), so this checks the value directly rather than via parseBooleanToken
    // (which only parses strings and would otherwise always read null here).
    beforeCreate: async (input, ctx) => {
      if ((input as RawCustomerGroupInput).isDefault === true) {
        const em = ctx.container.resolve('em') as EntityManager
        await clearOtherDefaultGroups(em, scopeFromContext(ctx).tenantId)
      }
    },
    beforeUpdate: async (input, ctx) => {
      const raw = input as RawCustomerGroupInput
      if (raw.isDefault === true && typeof raw.id === 'string') {
        const em = ctx.container.resolve('em') as EntityManager
        await clearOtherDefaultGroups(em, scopeFromContext(ctx).tenantId, raw.id)
      }
    },
  },
})
