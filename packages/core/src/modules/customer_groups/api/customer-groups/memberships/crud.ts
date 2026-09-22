import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError, conflict } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CustomerGroupMembership } from '../../../data/entities'
import {
  customerGroupMembershipCreateSchema,
  customerGroupMembershipUpdateSchema,
  type CustomerGroupMembershipCreateInput,
  type CustomerGroupMembershipUpdateInput,
} from '../../../data/validators'

// Mirrors `../crud.ts` (the base `CustomerGroup` CRUD) exactly: a single shared
// `makeCrudRoute` instance consumed by the sibling `route.ts`, no `[id]` dynamic
// segment — `makeCrudRoute` reads `id` from the query string (list/delete) or
// body (create/update).

const rawBodySchema = z.object({}).passthrough()
type RawCustomerGroupMembershipInput = z.infer<typeof rawBodySchema>

export const customerGroupMembershipListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
    activeOnly: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

export type CustomerGroupMembershipListQuery = z.infer<typeof customerGroupMembershipListQuerySchema>

export const customerGroupMembershipRouteMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customer_groups.memberships.view'] },
  POST: { requireAuth: true, requireFeatures: ['customer_groups.memberships.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customer_groups.memberships.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customer_groups.memberships.manage'] },
}

// `CustomerGroupMembership.organizationId` has the identical nullable-column
// shape as `CustomerGroup.organizationId` (see the doc comment on the entity in
// `data/entities.ts`), and memberships are looked up by `(tenant_id, group_id,
// customer_id)` — never by organization — so this route follows the base
// route's `orgField: null` choice: tenant-scoped only, organization recorded
// for a future per-organization phase but never filtered on.
function scopeFromContext(ctx: CrudCtx): { tenantId: string; organizationId?: string | null } {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) {
    throw new CrudHttpError(400, { error: '[internal] customer group membership scope is missing a tenant id' })
  }
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  return { tenantId, organizationId }
}

function parseCreateInput(input: RawCustomerGroupMembershipInput, ctx: CrudCtx): CustomerGroupMembershipCreateInput {
  return customerGroupMembershipCreateSchema.parse({ ...input, ...scopeFromContext(ctx) })
}

function parseUpdateInput(input: RawCustomerGroupMembershipInput, ctx: CrudCtx): CustomerGroupMembershipUpdateInput {
  return customerGroupMembershipUpdateSchema.parse({ ...input, ...scopeFromContext(ctx) })
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function toCustomerGroupMembershipEntityData(input: CustomerGroupMembershipCreateInput): Record<string, unknown> {
  return {
    organizationId: input.organizationId ?? null,
    tenantId: input.tenantId,
    groupId: input.groupId,
    customerId: input.customerId,
    source: input.source ?? 'manual',
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    assignedByUserId: input.assignedByUserId ?? null,
    notes: input.notes ?? null,
  }
}

// Scope fields (tenantId/organizationId) are deliberately excluded — same rule
// as `applyCustomerGroupUpdate` in `../crud.ts`.
function applyCustomerGroupMembershipUpdate(
  entity: CustomerGroupMembership,
  input: CustomerGroupMembershipUpdateInput,
): void {
  if (hasOwn(input, 'groupId') && input.groupId) entity.groupId = input.groupId
  if (hasOwn(input, 'customerId') && input.customerId) entity.customerId = input.customerId
  if (hasOwn(input, 'source') && input.source) entity.source = input.source
  if (hasOwn(input, 'validFrom')) entity.validFrom = input.validFrom ?? null
  if (hasOwn(input, 'validUntil')) entity.validUntil = input.validUntil ?? null
  if (hasOwn(input, 'assignedByUserId')) entity.assignedByUserId = input.assignedByUserId ?? null
  if (hasOwn(input, 'notes')) entity.notes = input.notes ?? null
}

// The DB enforces uniqueness of `(tenant_id, group_id, customer_id)` among
// non-deleted rows via the partial unique index
// `customer_group_memberships_active_unique` (see data/entities.ts). Without a
// pre-check, a raw Postgres unique-violation reaching `makeCrudRoute`'s create
// step would fall through `handleError`'s generic 500 branch — `factory.ts`'s
// `handleError` only special-cases foreign-key violations and transient DB
// errors, not unique violations. Pre-checking here and throwing a translated
// `conflict()` mirrors the async `beforeCreate`/`beforeUpdate` uniqueness-guard
// pattern used by `warranty_claims/api/registrations/route.ts`
// (`assertRegistrationSerialUnique`), adapted from its `mapToEntity`-only shape
// since `makeCrudRoute`'s `create.mapToEntity` is not awaited and cannot itself
// run an async pre-check — only `hooks.beforeCreate`/`beforeUpdate` are.
async function assertMembershipUnique(
  em: EntityManager,
  scope: { tenantId: string },
  groupId: string,
  customerId: string,
  excludeId: string | null,
  translate: (key: string, fallback?: string) => string,
): Promise<void> {
  const where: FilterQuery<CustomerGroupMembership> = {
    tenantId: scope.tenantId,
    groupId,
    customerId,
    deletedAt: null,
  }
  if (excludeId) where.id = { $ne: excludeId }
  const existing = await em.count(CustomerGroupMembership, where)
  if (existing > 0) {
    throw conflict(
      translate('customer_groups.errors.membershipDuplicate', 'This customer is already a member of this group.'),
    )
  }
}

const customerGroupMembershipListFields = [
  'id',
  'organization_id',
  'tenant_id',
  'group_id',
  'customer_id',
  'source',
  'valid_from',
  'valid_until',
  'assigned_by_user_id',
  'notes',
  'created_at',
  'updated_at',
]

export const customerGroupMembershipCrud = makeCrudRoute<
  RawCustomerGroupMembershipInput,
  RawCustomerGroupMembershipInput,
  CustomerGroupMembershipListQuery
>({
  metadata: customerGroupMembershipRouteMetadata,
  orm: {
    entity: CustomerGroupMembership,
    idField: 'id',
    // Tenant-scoped only, matching `CustomerGroup` — see the doc comment above
    // `scopeFromContext`.
    orgField: null,
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  // No `E.customer_groups.*` entry exists yet (same as the base `CustomerGroup`
  // route) — the string-literal fallback matches `../crud.ts`.
  indexer: { entityType: 'customer_groups:customer_group_membership' },
  list: {
    schema: customerGroupMembershipListQuerySchema,
    entityId: 'customer_groups:customer_group_membership',
    fields: customerGroupMembershipListFields,
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      validFrom: 'valid_from',
      validUntil: 'valid_until',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.customerId) filters.customer_id = { $eq: query.customerId }
      if (query.groupId) filters.group_id = { $eq: query.groupId }
      const activeOnly = parseBooleanToken(query.activeOnly)
      if (activeOnly === true) {
        const now = new Date()
        filters.$and = [
          { $or: [{ valid_from: null }, { valid_from: { $lte: now } }] },
          { $or: [{ valid_until: null }, { valid_until: { $gte: now } }] },
        ]
      }
      return filters
    },
  },
  create: {
    schema: rawBodySchema,
    mapToEntity: (input, ctx) => toCustomerGroupMembershipEntityData(parseCreateInput(input, ctx)),
  },
  update: {
    schema: rawBodySchema,
    getId: (input) => (typeof input.id === 'string' ? input.id : ''),
    applyToEntity: (entity, input, ctx) => {
      applyCustomerGroupMembershipUpdate(entity as CustomerGroupMembership, parseUpdateInput(input, ctx))
    },
    response: () => ({ ok: true }),
  },
  del: { idFrom: 'query', softDelete: true, response: () => ({ ok: true }) },
  hooks: {
    beforeCreate: async (input, ctx) => {
      const scope = scopeFromContext(ctx)
      const result = customerGroupMembershipCreateSchema.safeParse({ ...input, ...scope })
      if (!result.success) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const { translate } = await resolveTranslations()
      await assertMembershipUnique(em, scope, result.data.groupId, result.data.customerId, null, translate)
    },
    beforeUpdate: async (input, ctx) => {
      const scope = scopeFromContext(ctx)
      const result = customerGroupMembershipUpdateSchema.safeParse({ ...input, ...scope })
      if (!result.success) return
      const parsed = result.data
      if (parsed.groupId === undefined && parsed.customerId === undefined) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const existing = await em.findOne(CustomerGroupMembership, {
        id: parsed.id,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      if (!existing) return
      const nextGroupId = parsed.groupId ?? existing.groupId
      const nextCustomerId = parsed.customerId ?? existing.customerId
      const { translate } = await resolveTranslations()
      await assertMembershipUnique(em, scope, nextGroupId, nextCustomerId, existing.id, translate)
    },
  },
})
