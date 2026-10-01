import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError, badRequest, conflict, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { canonicalizeResourceTag, invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { E } from '#generated/entities.ids.generated'
import { CustomerGroup, CustomerGroupMembership, CustomerGroupTerms } from '../../data/entities'
import {
  CUSTOMER_GROUP_MAX_ANCESTOR_DEPTH,
  customerGroupCreateSchema,
  customerGroupUpdateSchema,
  type CustomerGroupCreateInput,
  type CustomerGroupUpdateInput,
} from '../../data/validators'
import { emitCustomerGroupLifecycleEvent } from '../../lib/groupEvents'
import { clearCreateConflictRecheck, registerCreateConflictRecheck } from '../../lib/createConflictRecheck'
import { countGroupMembershipsOutsideScope } from '../../lib/customerScope'
import { emitMembershipEvent } from './memberships/crud'

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
// Returns the ids of the groups whose flag was cleared, so the caller can announce
// them once its transaction committed.
export async function clearOtherDefaultGroups(em: EntityManager, tenantId: string, excludeId?: string): Promise<string[]> {
  const where: FilterQuery<CustomerGroup> = { tenantId, isDefault: true, deletedAt: null }
  if (excludeId) where.id = { $ne: excludeId }
  const cleared = await em.find(CustomerGroup, where, { fields: ['id'] })
  await em.nativeUpdate(CustomerGroup, where, { isDefault: false, updatedAt: new Date() })
  return cleared.map((group) => group.id)
}

// The group list route's CRUD cache resource kind and its entity-name alias, the same
// tags `commands/reorderGroups.ts` flushes for its own bulk writes.
const CUSTOMER_GROUP_CACHE_RESOURCE = canonicalizeResourceTag('customer_groups.group') ?? 'customer_groups.group'
const CUSTOMER_GROUP_CACHE_ALIASES = [canonicalizeResourceTag('CustomerGroup') ?? 'customer.group']

// A previous default cleared by a native statement bypasses the factory, so it gets the
// route's `customer_groups.group.updated` and cache flush here instead.
export async function announceClearedDefaultGroups(
  container: CrudCtx['container'],
  tenantId: string,
  groupIds: string[],
): Promise<void> {
  for (const id of groupIds) {
    await invalidateCrudCache(
      container,
      CUSTOMER_GROUP_CACHE_RESOURCE,
      { id, tenantId, organizationId: null },
      tenantId,
      'updated',
      CUSTOMER_GROUP_CACHE_ALIASES,
    )
    await emitCustomerGroupLifecycleEvent('customer_groups.group.updated', { id, tenantId })
  }
}

const CUSTOMER_GROUP_DEFAULT_UNIQUE_CONSTRAINT = 'customer_groups_tenant_default_unique'

// The memberships route has no `events`/`actions`, so `makeCrudRoute` tags its list
// cache with the canonicalized entity name; the group delete cascade flushes the same tag.
// Every membership list entry carries the tenant's `org:null` collection tag (the route
// is `orgField: null`), so one flush without a record id covers every removed row.
const CUSTOMER_GROUP_MEMBERSHIP_CACHE_RESOURCE =
  canonicalizeResourceTag('CustomerGroupMembership') ?? 'customer.group.membership'

// Clear-and-set cannot stop two CONCURRENT promotions: each clears the defaults it can
// see, then both set their own row, and the loser trips the partial unique index
// `customer_groups_tenant_default_unique`. That is a real conflict (the other write
// won), so it maps to a translated 409 instead of reaching the factory's generic 500.
export function toDefaultGroupConflict(err: unknown, translate: Translate): unknown {
  if (!isUniqueViolation(err, CUSTOMER_GROUP_DEFAULT_UNIQUE_CONSTRAINT)) return err
  return conflict(
    translate(
      'customer_groups.errors.defaultConflict',
      'Another customer group was made the default at the same time. Reload and try again.',
    ),
  )
}

const CUSTOMER_GROUP_CODE_UNIQUE_CONSTRAINT = 'customer_groups_tenant_code_unique'
const CUSTOMER_GROUP_PRIORITY_UNIQUE_CONSTRAINT = 'customer_groups_tenant_priority_unique'

// The pre-checks in `assertCustomerGroupWriteAllowed` cannot see a concurrent write that
// commits between the check and the flush; the partial unique indexes then reject the
// loser, which maps to the same translated 409 the pre-check answers.
export function toCustomerGroupUniqueConflict(err: unknown, translate: Translate): unknown {
  if (isUniqueViolation(err, CUSTOMER_GROUP_CODE_UNIQUE_CONSTRAINT)) {
    return conflict(translate('customer_groups.errors.codeDuplicate', 'A customer group with this code already exists.'))
  }
  if (isUniqueViolation(err, CUSTOMER_GROUP_PRIORITY_UNIQUE_CONSTRAINT)) {
    return conflict(
      translate('customer_groups.errors.priorityDuplicate', 'Another customer group already uses this priority.'),
    )
  }
  return toDefaultGroupConflict(err, translate)
}

// `makeCrudRoute`'s create transaction wraps only the insert, so a new default group is
// inserted with `isDefault: false` and promoted here, after the insert committed, in its
// own transaction: clear the previous default first, then set the new one, so the
// partial unique index is never violated and a failed create never touches the old
// default. The group row is already committed at this point, so a concurrent promotion
// that wins the unique index is retried rather than reported: a fresh transaction sees
// the winner committed and replaces it, exactly as two sequential creates would. If every
// attempt loses, the create still succeeds as a non-default group (see `afterCreate`).
const DEFAULT_PROMOTION_ATTEMPTS = 3

export async function promoteDefaultGroup(em: EntityManager, tenantId: string, groupId: string, now: Date): Promise<string[]> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await em.transactional(async (tem) => {
        const cleared = await clearOtherDefaultGroups(tem, tenantId, groupId)
        await tem.nativeUpdate(CustomerGroup, { id: groupId, tenantId, deletedAt: null }, { isDefault: true, updatedAt: now })
        return cleared
      })
    } catch (err) {
      if (attempt >= DEFAULT_PROMOTION_ATTEMPTS || !isUniqueViolation(err, CUSTOMER_GROUP_DEFAULT_UNIQUE_CONSTRAINT)) throw err
    }
  }
}

// Previous defaults cleared inside the factory's update transaction, keyed by the
// updated entity instance (which `afterUpdate` receives) and announced only once the
// write committed, so a rolled-back update never emits for them.
const clearedDefaultGroupsByUpdate = new WeakMap<CustomerGroup, string[]>()

// The update path's counterpart of `promoteDefaultGroup`: runs inside the factory's
// update transaction and writes the flag with a native statement (rather than leaving
// it to the entity flush) so a concurrent promotion's unique violation surfaces here,
// where it can be mapped to a 409.
export async function assignDefaultGroup(
  em: EntityManager,
  tenantId: string,
  groupId: string,
  translate: Translate,
): Promise<string[]> {
  try {
    const cleared = await clearOtherDefaultGroups(em, tenantId, groupId)
    await em.nativeUpdate(CustomerGroup, { id: groupId, tenantId, deletedAt: null }, { isDefault: true })
    return cleared
  } catch (err) {
    throw toDefaultGroupConflict(err, translate)
  }
}

// Terms of a deleted group must stop resolving; soft-deleting them (rather than leaving
// them to be filtered by the group join) keeps `customer_group_terms_group_unique` free
// for a future group and keeps every terms reader correct without a join.
export async function softDeleteGroupTerms(em: EntityManager, tenantId: string, groupId: string): Promise<void> {
  const now = new Date()
  await em.nativeUpdate(CustomerGroupTerms, { tenantId, groupId, deletedAt: null }, { deletedAt: now, updatedAt: now })
}

// A deleted group's memberships must stop counting too: without this they stay live,
// keep occupying `customer_group_memberships_active_unique`, and keep listing the
// customer under a group that no longer exists. Only the rows read here are
// soft-deleted, so the returned rows are exactly the ones a `membership.removed` event
// is owed for.
export async function softDeleteGroupMemberships(
  em: EntityManager,
  tenantId: string,
  groupId: string,
): Promise<CustomerGroupMembership[]> {
  const memberships = await em.find(CustomerGroupMembership, { tenantId, groupId, deletedAt: null })
  if (!memberships.length) return []
  const now = new Date()
  await em.nativeUpdate(
    CustomerGroupMembership,
    { tenantId, groupId, deletedAt: null, id: { $in: memberships.map((membership) => membership.id) } },
    { deletedAt: now, updatedAt: now },
  )
  return memberships
}

// The delete cascade runs after `makeCrudRoute` soft-deleted the group (the factory has
// no hook inside its delete), so terms and memberships are retired together in one
// transaction and, if that transaction fails, the group delete is reverted: the request
// fails with the group, its terms and its memberships all still live, never half-deleted.
// The organizations the caller's role may reach (`null` = unrestricted). This is the
// permission boundary, not the header selection: an unrestricted admin working in one
// organization may still delete a shared group.
function permittedOrganizationIds(ctx: CrudCtx): string[] | null {
  if (!ctx.organizationScope) return ctx.organizationIds
  const allowedIds = ctx.organizationScope.allowedIds
  return Array.isArray(allowedIds) ? Array.from(new Set(allowedIds)) : null
}

// A caller restricted to some organizations may only delete a group whose live
// members are all customers of those organizations: the cascade retires every
// membership of the group, and the membership routes refuse that same caller each
// out-of-scope membership one by one (see `lib/customerScope.ts`).
export async function assertGroupMembershipsInScope(
  em: EntityManager,
  tenantId: string,
  groupId: string,
  organizationIds: string[] | null,
  translate: Translate,
): Promise<void> {
  if ((await countGroupMembershipsOutsideScope(em, groupId, { tenantId, organizationIds })) === 0) return
  throw conflict(
    translate(
      'customer_groups.errors.deleteMembersOutsideScope',
      'This group has members in organizations you cannot access, so you cannot delete it.',
    ),
  )
}

export async function cascadeGroupDelete(
  em: EntityManager,
  tenantId: string,
  groupId: string,
  assertInScope?: (tem: EntityManager) => Promise<void>,
): Promise<CustomerGroupMembership[]> {
  try {
    return await em.transactional(async (tem) => {
      if (assertInScope) await assertInScope(tem)
      await softDeleteGroupTerms(tem, tenantId, groupId)
      return softDeleteGroupMemberships(tem, tenantId, groupId)
    })
  } catch (err) {
    await em.nativeUpdate(CustomerGroup, { id: groupId, tenantId, deletedAt: { $ne: null } }, { deletedAt: null })
    throw err
  }
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
// of the tenant; `groupId` is null on create. The chain ends at the first ancestor that
// is not in `groups` (soft-deleted or dangling), exactly where the terms walk in
// `loadCustomerGroupAncestorChain` ends, so such an ancestor never counts toward the
// depth. Inactive ancestors DO count: activity is toggled freely, and reactivating a
// group must never produce an over-deep hierarchy.
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
    const ancestor = byId.get(currentId)
    if (!ancestor) break
    visited.add(currentId)
    chainLength += 1
    currentId = ancestor.parentId ?? null
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
  indexer: { entityType: E.customer_groups.customer_group },
  list: {
    schema: customerGroupListQuerySchema,
    entityId: E.customer_groups.customer_group,
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
    response: (entity) => {
      const group = entity as CustomerGroup
      return { id: group.id, isDefault: group.isDefault }
    },
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
      if (parsed.isDefault === true) {
        clearedDefaultGroupsByUpdate.set(group, await assignDefaultGroup(em, group.tenantId, group.id, translate))
      }
      applyCustomerGroupUpdate(group, parsed)
      try {
        await em.flush()
      } catch (err) {
        throw toCustomerGroupUniqueConflict(err, translate)
      }
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
      const check: CustomerGroupWriteCheck = {
        tenantId: scope.tenantId,
        groupId: null,
        code: result.data.code,
        priority: result.data.priority,
        parentId: result.data.parentId ?? null,
      }
      await assertCustomerGroupWriteAllowed(em, check, translate)
      registerCreateConflictRecheck(ctx.request, () =>
        assertCustomerGroupWriteAllowed(
          (ctx.container.resolve('em') as EntityManager).fork(),
          { tenantId: check.tenantId, groupId: null, code: check.code, priority: check.priority },
          translate,
        ),
      )
    },
    afterCreate: async (entity, ctx) => {
      clearCreateConflictRecheck(ctx.request)
      const group = entity as CustomerGroup
      if (parseCreateInput(ctx.input, ctx).isDefault !== true) return
      const now = new Date()
      let cleared: string[]
      try {
        cleared = await promoteDefaultGroup(ctx.container.resolve('em') as EntityManager, group.tenantId, group.id, now)
      } catch (err) {
        if (isUniqueViolation(err, CUSTOMER_GROUP_DEFAULT_UNIQUE_CONSTRAINT)) return
        throw err
      }
      group.isDefault = true
      group.updatedAt = now
      await announceClearedDefaultGroups(ctx.container, group.tenantId, cleared)
    },
    afterUpdate: async (entity, ctx) => {
      const group = entity as CustomerGroup
      const cleared = clearedDefaultGroupsByUpdate.get(group)
      if (!cleared) return
      clearedDefaultGroupsByUpdate.delete(group)
      await announceClearedDefaultGroups(ctx.container, group.tenantId, cleared)
    },
    beforeDelete: async (id, ctx) => {
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const { tenantId } = scopeFromContext(ctx)
      const { translate } = await resolveTranslations()
      await assertGroupMembershipsInScope(em, tenantId, id, permittedOrganizationIds(ctx), translate)
    },
    afterDelete: async (id, ctx) => {
      const em = ctx.container.resolve('em') as EntityManager
      const { tenantId } = scopeFromContext(ctx)
      const { translate } = await resolveTranslations()
      const removedMemberships = await cascadeGroupDelete(em, tenantId, id, (tem) =>
        assertGroupMembershipsInScope(tem, tenantId, id, permittedOrganizationIds(ctx), translate),
      )
      if (!removedMemberships.length) return
      await invalidateCrudCache(
        ctx.container,
        CUSTOMER_GROUP_MEMBERSHIP_CACHE_RESOURCE,
        { id: null, tenantId, organizationId: null },
        tenantId,
        'deleted',
      )
      for (const membership of removedMemberships) {
        await emitMembershipEvent('customer_groups.membership.removed', membership)
      }
    },
  },
})
