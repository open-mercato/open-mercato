import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError, badRequest, conflict } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CustomerGroup, CustomerGroupTerms } from '../../data/entities'
import {
  CUSTOMER_GROUP_MAX_ANCESTOR_DEPTH,
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

type Translate = (key: string, fallback?: string) => string

// "At most one is_default per tenant" (spec §5.1) has a DB-level backstop (the
// partial unique index `customer_groups_tenant_default_unique` in data/entities.ts)
// but that only throws a raw unique-violation on conflict — it does not implement
// the spec's actual UX ("enabling this will replace it"). Clear-and-set semantics:
// unset every other default group for the tenant in one bulk statement, so the new
// default always wins cleanly instead of racing the unique index. Callers MUST only
// run this once the write is known to be valid (see `applyToEntity` / `afterCreate`
// below), otherwise a rejected request would still wipe the tenant's default.
export async function clearOtherDefaultGroups(em: EntityManager, tenantId: string, excludeId?: string): Promise<void> {
  const where: Record<string, unknown> = { tenantId, isDefault: true, deletedAt: null }
  if (excludeId) where.id = { $ne: excludeId }
  await em.nativeUpdate(CustomerGroup, where, { isDefault: false, updatedAt: new Date() })
}

// `makeCrudRoute`'s create transaction wraps only the insert, so a new default group is
// inserted with `isDefault: false` and promoted here, after the insert committed, in its
// own transaction: clear the previous default first, then set the new one, so the
// partial unique index is never violated and a failed create never touches the old
// default.
export async function promoteDefaultGroup(em: EntityManager, tenantId: string, groupId: string, now: Date): Promise<void> {
  await em.transactional(async (tem) => {
    await clearOtherDefaultGroups(tem, tenantId, groupId)
    await tem.nativeUpdate(CustomerGroup, { id: groupId, tenantId, deletedAt: null }, { isDefault: true, updatedAt: now })
  })
}

// Terms of a deleted group must stop resolving; soft-deleting them (rather than leaving
// them to be filtered by the group join) keeps `customer_group_terms_group_unique` free
// for a future group and keeps every terms reader correct without a join.
export async function softDeleteGroupTerms(em: EntityManager, tenantId: string, groupId: string): Promise<void> {
  const now = new Date()
  await em.nativeUpdate(CustomerGroupTerms, { tenantId, groupId, deletedAt: null }, { deletedAt: now, updatedAt: now })
}

export type CustomerGroupNode = { id: string; parentId?: string | null }
export type CustomerGroupParentIssue = 'notFound' | 'self' | 'cycle' | 'tooDeep'

function measureSubtreeHeight(groups: CustomerGroupNode[], rootId: string): number {
  const childrenByParent = new Map<string, string[]>()
  for (const group of groups) {
    if (!group.parentId) continue
    const children = childrenByParent.get(group.parentId) ?? []
    children.push(group.id)
    childrenByParent.set(group.parentId, children)
  }
  const seen = new Set<string>([rootId])
  let level = [rootId]
  let height = 0
  while (level.length) {
    height += 1
    const next: string[] = []
    for (const id of level) {
      for (const childId of childrenByParent.get(id) ?? []) {
        if (seen.has(childId)) continue
        seen.add(childId)
        next.push(childId)
      }
    }
    level = next
  }
  return height
}

// Spec §5.1: `parent_id` must reference a live group of the same tenant, must not form
// a cycle, and the resulting hierarchy depth is capped — counting the new parent's
// ancestor chain plus the (moved) group's own subtree, so re-parenting a group with
// children cannot push a descendant past the cap either. `groups` is every live group
// of the tenant; `groupId` is null on create.
export function findParentAssignmentIssue(
  groups: CustomerGroupNode[],
  groupId: string | null,
  parentId: string,
  maxDepth: number = CUSTOMER_GROUP_MAX_ANCESTOR_DEPTH,
): CustomerGroupParentIssue | null {
  if (groupId && parentId === groupId) return 'self'
  const byId = new Map(groups.map((group) => [group.id, group]))
  if (!byId.has(parentId)) return 'notFound'
  const visited = new Set<string>()
  let currentId: string | null = parentId
  let chainLength = 0
  while (currentId) {
    if (currentId === groupId || visited.has(currentId)) return 'cycle'
    visited.add(currentId)
    chainLength += 1
    currentId = byId.get(currentId)?.parentId ?? null
  }
  const subtreeHeight = groupId ? measureSubtreeHeight(groups, groupId) : 1
  return chainLength + subtreeHeight > maxDepth ? 'tooDeep' : null
}

const parentIssueMessages: Record<CustomerGroupParentIssue, { key: string; fallback: string }> = {
  notFound: { key: 'customer_groups.errors.parentNotFound', fallback: 'The selected parent group does not exist.' },
  self: { key: 'customer_groups.errors.parentSelf', fallback: 'A group cannot be its own parent.' },
  cycle: {
    key: 'customer_groups.errors.parentCycle',
    fallback: 'The selected parent is a descendant of this group, which would create a cycle.',
  },
  tooDeep: {
    key: 'customer_groups.errors.parentTooDeep',
    fallback: 'This parent would make the group hierarchy deeper than 5 levels.',
  },
}

export type CustomerGroupWriteCheck = {
  tenantId: string
  groupId: string | null
  code?: string
  priority?: number
  parentId?: string | null
}

// `code` and live `priority` are unique per tenant (spec §5.1, partial unique indexes in
// data/entities.ts). A raw unique violation would reach `makeCrudRoute`'s generic 500
// branch, so they are pre-checked with a translated 409 — the same pattern as
// `assertMembershipUnique` in `memberships/crud.ts`. Only fields present in `check` are
// validated, so an update that leaves a field unchanged skips its query.
export async function assertCustomerGroupWriteAllowed(
  em: EntityManager,
  check: CustomerGroupWriteCheck,
  translate: Translate,
): Promise<void> {
  const { tenantId, groupId } = check
  if (check.code !== undefined) {
    const where: FilterQuery<CustomerGroup> = { tenantId, code: check.code, deletedAt: null }
    if (groupId) where.id = { $ne: groupId }
    if ((await em.count(CustomerGroup, where)) > 0) {
      throw conflict(translate('customer_groups.errors.codeDuplicate', 'A customer group with this code already exists.'))
    }
  }
  if (check.priority !== undefined) {
    const where: FilterQuery<CustomerGroup> = { tenantId, priority: check.priority, deletedAt: null }
    if (groupId) where.id = { $ne: groupId }
    if ((await em.count(CustomerGroup, where)) > 0) {
      throw conflict(
        translate('customer_groups.errors.priorityDuplicate', 'Another customer group already uses this priority.'),
      )
    }
  }
  if (check.parentId) {
    const groups = await em.find(CustomerGroup, { tenantId, deletedAt: null })
    const issue = findParentAssignmentIssue(groups, groupId, check.parentId)
    if (issue) {
      const message = parentIssueMessages[issue]
      throw badRequest(translate(message.key, message.fallback))
    }
  }
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
  // Emits `customer_groups.group.created|updated|deleted` (the factory composes
  // `${module}.${entity}.${action}`), matching the ids declared in `events.ts`.
  events: { module: 'customer_groups', entity: 'group', persistent: true },
  create: {
    schema: rawBodySchema,
    // Always inserted as non-default; `afterCreate` promotes it (see `promoteDefaultGroup`).
    mapToEntity: (input, ctx) => ({ ...toCustomerGroupEntityData(parseCreateInput(input, ctx)), isDefault: false }),
  },
  update: {
    schema: rawBodySchema,
    getId: (input) => (typeof input.id === 'string' ? input.id : ''),
    // Runs inside the factory's update transaction, after the record was found in the
    // caller's tenant — so validation and the default reassignment commit or roll back
    // together with the write. Reads/bulk updates happen before any scalar mutation.
    applyToEntity: async (entity, input, ctx) => {
      const group = entity as CustomerGroup
      const parsed = parseUpdateInput(input, ctx)
      const em = ctx.container.resolve('em') as EntityManager
      const { translate } = await resolveTranslations()
      const nextParentId = hasOwn(parsed, 'parentId') ? parsed.parentId ?? null : undefined
      await assertCustomerGroupWriteAllowed(
        em,
        {
          tenantId: group.tenantId,
          groupId: group.id,
          code: parsed.code !== undefined && parsed.code !== group.code ? parsed.code : undefined,
          priority: parsed.priority !== undefined && parsed.priority !== group.priority ? parsed.priority : undefined,
          parentId: nextParentId !== undefined && nextParentId !== (group.parentId ?? null) ? nextParentId : undefined,
        },
        translate,
      )
      if (parsed.isDefault === true) await clearOtherDefaultGroups(em, group.tenantId, group.id)
      applyCustomerGroupUpdate(group, parsed)
    },
    response: () => ({ ok: true }),
  },
  del: { idFrom: 'query', softDelete: true, response: () => ({ ok: true }) },
  hooks: {
    beforeCreate: async (input, ctx) => {
      const scope = scopeFromContext(ctx)
      const result = customerGroupCreateSchema.safeParse({ ...input, ...scope })
      if (!result.success) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const { translate } = await resolveTranslations()
      await assertCustomerGroupWriteAllowed(
        em,
        {
          tenantId: scope.tenantId,
          groupId: null,
          code: result.data.code,
          priority: result.data.priority,
          parentId: result.data.parentId ?? null,
        },
        translate,
      )
    },
    afterCreate: async (entity, ctx) => {
      const group = entity as CustomerGroup
      if (parseCreateInput(ctx.input, ctx).isDefault !== true) return
      const now = new Date()
      await promoteDefaultGroup(ctx.container.resolve('em') as EntityManager, group.tenantId, group.id, now)
      group.isDefault = true
      group.updatedAt = now
    },
    afterDelete: async (id, ctx) => {
      await softDeleteGroupTerms(ctx.container.resolve('em') as EntityManager, scopeFromContext(ctx).tenantId, id)
    },
  },
})
