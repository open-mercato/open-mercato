import type { EntityManager } from '@mikro-orm/postgresql'
import { unionScopes } from '@open-mercato/shared/lib/catalog-visibility'
import type { AssortmentScope, EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import { CustomerGroup, CustomerGroupMembership, CustomerGroupTerms } from '../data/entities'
import { CUSTOMER_GROUP_MAX_ANCESTOR_DEPTH } from '../data/validators'

export type GroupResolution = {
  groupIds: string[]
  groups: Array<{ id: string; code: string; name: string; kind: string; priority: number }>
}

// The five scalar fields `resolveTerms` resolves per group, independently of one
// another (spec §6.1). Kept as a `const` tuple (not a hardcoded literal union) so the
// resolution loop and the `sources` map share a single source of truth for the field
// list.
const TERMS_FIELD_NAMES = [
  'priceKindId',
  'paymentTermsDays',
  'allowPurchaseOnAccount',
  'approvalRequiredAbove',
  'minOrderValue',
] as const
type TermsFieldName = (typeof TERMS_FIELD_NAMES)[number]

// Spec §6.1's illustrative type sketch shows a single shared `sourceGroupId` on
// `ResolvedTerms`, but its own acceptance criteria (US-C2: "each resolved scalar
// field... shows its value and the group it came from") require independent
// per-field provenance — a customer can get `paymentTermsDays` from a grandparent
// while `priceKindId` comes straight from its own group. Modeled as a `sources` map
// keyed by field name (rather than five parallel `<field>SourceGroupId` fields) so
// the resolution loop can write `result.sources[field] = groupId` generically instead
// of a per-field switch, and so a future terms field only needs adding to
// `TERMS_FIELD_NAMES` instead of a new parallel field everywhere.
export type ResolvedTermsSources = Record<TermsFieldName, string | null>

export type ResolvedTerms = {
  priceKindId: string | null
  paymentTermsDays: number | null
  allowPurchaseOnAccount: boolean
  approvalRequiredAbove: number | null
  minOrderValue: number | null
  sources: ResolvedTermsSources
}

// Ancestor-walk depth cap — the group hierarchy's own depth cap (spec §5.1, enforced at
// create/update time by `findParentAssignmentIssue`), shared so the two cannot drift.
// Defensive only: normal data can never produce a chain this long, but this stops a
// corrupt/cyclic `parentId` graph from looping forever.
const MAX_ANCESTOR_DEPTH = CUSTOMER_GROUP_MAX_ANCESTOR_DEPTH

// `customer_groups` entities are tenant-scoped only (see the "Groups are
// tenant-scoped, not organization-scoped" note in `data/entities.ts`), and this
// codebase has no ambient/DI-resolved tenant context — `createRequestContainer()`
// (packages/shared/src/lib/di/container.ts) builds the container before auth is
// resolved, and every DB-querying DI service in this repo that needs tenant scope
// takes it as an explicit caller-supplied argument (see
// `warranty_claims/services/entitlementResolver.ts`'s `resolveEntitlement(input, scope, em)`).
// The illustrative `resolveGroups(input: { customerId, at })` signature in
// `.ai/specs/2026-08-14-customer-groups-and-b2b-terms.md` §6 omits `tenantId` for
// brevity; `tenantId` is added here to the input so this service can never silently
// query across tenants (root AGENTS.md § Never: "expose cross-tenant data or skip
// tenant/organization scoping").
export type ResolveGroupsInput = {
  customerId: string | null
  customerIds?: string[]
  tenantId: string
  at?: Date
}

// `groupIds` is optional and, when supplied by a caller who already resolved the
// customer's groups, skips the membership-resolution query inside `resolveTerms` —
// `resolveGroups`'s own DB round-trips (memberships + groups, or the tenant-default
// lookup) are not repeated. Ancestor/terms rows are still fetched fresh regardless,
// since `resolveGroups` never returns those.
export type ResolveTermsInput = {
  customerId: string | null
  customerIds?: string[]
  tenantId: string
  at?: Date
  groupIds?: string[]
}

// Same shape as `ResolveGroupsInput` — `resolveAssortmentScope` delegates straight to
// `resolveGroups()` and adds no extra inputs of its own. Aliased rather than reused
// directly so a future assortment-specific input (e.g. a channel id, once Phase 2 of
// catalog-visibility composes channel scope too) doesn't ripple through `resolveGroups`'s
// own signature.
export type ResolveAssortmentScopeInput = ResolveGroupsInput

export type ResolvedAssortmentScope = {
  scope: EffectiveAssortmentScope
  sourceGroupIds: string[]
  // Always `null` in Phase 1 — `CustomerAssortmentOverride` (per-customer override table)
  // is Phase 4 scope (spec §14 non-goals) and does not exist yet. Never read from anywhere;
  // this is a fixed literal until that phase lands.
  sourceCustomerOverrideId: string | null
}

export interface CustomerGroupsService {
  resolveGroups(input: ResolveGroupsInput): Promise<GroupResolution>
  resolveTerms(input: ResolveTermsInput): Promise<ResolvedTerms>
  resolveAssortmentScope(input: ResolveAssortmentScopeInput): Promise<ResolvedAssortmentScope>
}

const AUTHORED_ASSORTMENT_SCOPE_KEYS = [
  'categoryIds',
  'tagIds',
  'excludeProductIds',
  'excludeCategoryIds',
  'excludeTagIds',
] as const

export function normalizeAuthoredAssortmentScope(scope: AssortmentScope | null | undefined): AssortmentScope | null {
  if (!scope) return null
  const normalized: AssortmentScope = {}
  for (const key of AUTHORED_ASSORTMENT_SCOPE_KEYS) {
    const ids = scope[key]
    if (Array.isArray(ids) && ids.length > 0) normalized[key] = ids
  }
  return Object.keys(normalized).length > 0 ? normalized : null
}

async function loadGroupCached(
  em: EntityManager,
  groupId: string,
  tenantId: string,
  cache: Map<string, CustomerGroup | null>,
): Promise<CustomerGroup | null> {
  if (cache.has(groupId)) return cache.get(groupId) ?? null
  const group = await em.findOne(CustomerGroup, { id: groupId, tenantId, deletedAt: null })
  cache.set(groupId, group)
  return group
}

/**
 * One group's ancestor chain — self first, then parent, grandparent, ... up to
 * `MAX_ANCESTOR_DEPTH` — as loaded, non-deleted, active, same-tenant entities. The
 * walk stops at the first id that does not resolve (soft-deleted, other tenant, or
 * dangling `parentId`) or resolves to an inactive group (spec §5.1: inactive groups
 * are excluded from resolution): such a group is never part of the chain, so neither
 * its terms row nor anything above it can be inherited. Shared by `resolveTerms` and
 * the explain-terms route so the resolved value and the explained ancestor path always
 * come from the SAME chain. `cache` lets callers reuse group rows across several chains.
 */
export async function loadCustomerGroupAncestorChain(
  em: EntityManager,
  groupId: string,
  tenantId: string,
  cache: Map<string, CustomerGroup | null> = new Map(),
): Promise<CustomerGroup[]> {
  const chain: CustomerGroup[] = []
  let currentId: string | null = groupId
  while (currentId && chain.length < MAX_ANCESTOR_DEPTH) {
    const group = await loadGroupCached(em, currentId, tenantId, cache)
    if (!group || !group.isActive) break
    chain.push(group)
    currentId = group.parentId ?? null
  }
  return chain
}

export function resolveEffectiveCustomerIds(input: Pick<ResolveGroupsInput, 'customerId' | 'customerIds'>): string[] {
  const distinctIds: string[] = []
  for (const customerId of input.customerIds ?? []) {
    if (typeof customerId !== 'string' || !customerId.length) continue
    if (!distinctIds.includes(customerId)) distinctIds.push(customerId)
  }
  if (distinctIds.length) return distinctIds
  return input.customerId == null ? [] : [input.customerId]
}

type RankedMembership = {
  membership: CustomerGroupMembership
  customerIndex: number
}

function compareRankedMemberships(left: RankedMembership, right: RankedMembership): number {
  if (left.customerIndex !== right.customerIndex) return left.customerIndex - right.customerIndex
  return right.membership.createdAt.getTime() - left.membership.createdAt.getTime()
}

function toGroupSummary(group: CustomerGroup): GroupResolution['groups'][number] {
  return { id: group.id, code: group.code, name: group.name, kind: group.kind, priority: group.priority }
}

export function isMembershipValidAt(
  membership: Pick<CustomerGroupMembership, 'validFrom' | 'validUntil'>,
  at: Date,
): boolean {
  if (membership.validFrom && membership.validFrom.getTime() > at.getTime()) return false
  // Inclusive upper bound: a membership expiring exactly at `at` is still valid
  // AT that instant (spec-derived rule — see the module's di.ts contract task).
  if (membership.validUntil && membership.validUntil.getTime() < at.getTime()) return false
  return true
}

function tenantDefaultTerms(): ResolvedTerms {
  return {
    priceKindId: null,
    paymentTermsDays: null,
    allowPurchaseOnAccount: false,
    approvalRequiredAbove: null,
    minOrderValue: null,
    sources: {
      priceKindId: null,
      paymentTermsDays: null,
      allowPurchaseOnAccount: null,
      approvalRequiredAbove: null,
      minOrderValue: null,
    },
  }
}

function toNumberOrNull(value: string | null | undefined): number | null {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

// Every terms field is a nullable column: `null` means "not set on this group, keep
// walking the ancestor chain", so a group can override a single field and inherit the
// rest.
function termsFieldIsSet(terms: CustomerGroupTerms, field: TermsFieldName): boolean {
  switch (field) {
    case 'priceKindId':
      return terms.priceKindId != null
    case 'paymentTermsDays':
      return terms.paymentTermsDays != null
    case 'allowPurchaseOnAccount':
      return terms.allowPurchaseOnAccount != null
    case 'approvalRequiredAbove':
      return terms.approvalRequiredAbove != null
    case 'minOrderValue':
      return terms.minOrderValue != null
  }
}

function applyTermsField(
  result: ResolvedTerms,
  field: TermsFieldName,
  terms: CustomerGroupTerms,
  sourceGroupId: string,
): void {
  switch (field) {
    case 'priceKindId':
      result.priceKindId = terms.priceKindId ?? null
      break
    case 'paymentTermsDays':
      result.paymentTermsDays = terms.paymentTermsDays ?? null
      break
    case 'allowPurchaseOnAccount':
      result.allowPurchaseOnAccount = terms.allowPurchaseOnAccount === true
      break
    case 'approvalRequiredAbove':
      result.approvalRequiredAbove = toNumberOrNull(terms.approvalRequiredAbove)
      break
    case 'minOrderValue':
      result.minOrderValue = toNumberOrNull(terms.minOrderValue)
      break
  }
  result.sources[field] = sourceGroupId
}

export class DefaultCustomerGroupsService implements CustomerGroupsService {
  constructor(private readonly em: EntityManager) {}

  async resolveGroups(input: ResolveGroupsInput): Promise<GroupResolution> {
    const at = input.at ?? new Date()
    const customerIds = resolveEffectiveCustomerIds(input)

    if (!customerIds.length) return this.resolveDefaultGroup(input.tenantId)

    const memberships = await this.em.find(CustomerGroupMembership, {
      tenantId: input.tenantId,
      customerId: customerIds.length === 1 ? customerIds[0] : { $in: customerIds },
      deletedAt: null,
    })

    const validMemberships = memberships.filter((membership) => isMembershipValidAt(membership, at))
    if (!validMemberships.length) return this.resolveDefaultGroup(input.tenantId)

    // Precedence rule (spec §6.0): one membership represents each group — the one of
    // the earliest buyer identity (person before company), then the most recently
    // created one (e.g. re-added after a prior removal).
    const bestMembershipByGroupId = new Map<string, RankedMembership>()
    for (const membership of validMemberships) {
      const customerIndex = customerIds.indexOf(membership.customerId)
      const candidate: RankedMembership = {
        membership,
        customerIndex: customerIndex === -1 ? customerIds.length : customerIndex,
      }
      const existing = bestMembershipByGroupId.get(membership.groupId)
      if (!existing || compareRankedMemberships(candidate, existing) < 0) {
        bestMembershipByGroupId.set(membership.groupId, candidate)
      }
    }

    const groupIds = Array.from(bestMembershipByGroupId.keys())
    const groups = await this.em.find(CustomerGroup, {
      id: { $in: groupIds },
      tenantId: input.tenantId,
      isActive: true,
      deletedAt: null,
    })

    const sortedGroups = groups.slice().sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return compareRankedMemberships(bestMembershipByGroupId.get(a.id)!, bestMembershipByGroupId.get(b.id)!)
    })

    if (!sortedGroups.length) return this.resolveDefaultGroup(input.tenantId)

    return {
      groupIds: sortedGroups.map((group) => group.id),
      groups: sortedGroups.map(toGroupSummary),
    }
  }

  private async resolveDefaultGroup(tenantId: string): Promise<GroupResolution> {
    const defaultGroup = await this.em.findOne(CustomerGroup, {
      tenantId,
      isDefault: true,
      isActive: true,
      deletedAt: null,
    })
    if (!defaultGroup) return { groupIds: [], groups: [] }
    return { groupIds: [defaultGroup.id], groups: [toGroupSummary(defaultGroup)] }
  }

  async resolveTerms(input: ResolveTermsInput): Promise<ResolvedTerms> {
    const groupIds = input.groupIds
      ?? (
        await this.resolveGroups({
          customerId: input.customerId,
          customerIds: input.customerIds,
          tenantId: input.tenantId,
          at: input.at,
        })
      ).groupIds

    if (!groupIds.length) return tenantDefaultTerms()

    // One ancestor chain per matching group, in the SAME priority order `groupIds`
    // arrived in (self first, then parent, then grandparent, ... up to the depth
    // cap). Computed once up front — the field loop below walks these same chains
    // for every field, relying on `groupCache`/`termsCache` to avoid re-querying a
    // group/terms row visited by an earlier chain or an earlier field.
    const groupCache = new Map<string, CustomerGroup | null>()
    const termsCache = new Map<string, CustomerGroupTerms | null>()
    const chains: string[][] = []
    for (const groupId of groupIds) {
      const chain = await loadCustomerGroupAncestorChain(this.em, groupId, input.tenantId, groupCache)
      chains.push(chain.map((group) => group.id))
    }

    const result = tenantDefaultTerms()

    for (const field of TERMS_FIELD_NAMES) {
      // "highest-priority group with a non-null value → its ancestors" is ONE
      // resolution unit per priority-ordered group (spec §6.1): walk THIS group's
      // full ancestor chain to completion before moving to the next-priority group,
      // not "check every group's own row first, then every group's ancestors."
      chainLoop: for (const chain of chains) {
        for (const ancestorId of chain) {
          const terms = await this.loadTerms(ancestorId, input.tenantId, termsCache)
          if (!terms) continue
          if (!termsFieldIsSet(terms, field)) continue
          applyTermsField(result, field, terms, ancestorId)
          break chainLoop
        }
      }
    }

    return result
  }

  async resolveAssortmentScope(input: ResolveAssortmentScopeInput): Promise<ResolvedAssortmentScope> {
    const { groupIds } = await this.resolveGroups(input)
    const termsCache = new Map<string, CustomerGroupTerms | null>()
    const groupOwnScopes: Array<AssortmentScope | null> = []
    for (const groupId of groupIds) {
      groupOwnScopes.push(await this.loadGroupOwnAssortmentScope(groupId, input.tenantId, termsCache))
    }
    const scope = unionScopes(groupOwnScopes)
    return { scope, sourceGroupIds: groupIds, sourceCustomerOverrideId: null }
  }

  private async loadGroupOwnAssortmentScope(
    groupId: string,
    tenantId: string,
    termsCache: Map<string, CustomerGroupTerms | null>,
  ): Promise<AssortmentScope | null> {
    const terms = await this.loadTerms(groupId, tenantId, termsCache)
    return normalizeAuthoredAssortmentScope(terms?.assortmentScope)
  }

  private async loadTerms(
    groupId: string,
    tenantId: string,
    cache: Map<string, CustomerGroupTerms | null>,
  ): Promise<CustomerGroupTerms | null> {
    if (cache.has(groupId)) return cache.get(groupId) ?? null
    const terms = await this.em.findOne(CustomerGroupTerms, { groupId, tenantId, deletedAt: null })
    cache.set(groupId, terms)
    return terms
  }
}

export function createCustomerGroupsService(em: EntityManager): CustomerGroupsService {
  return new DefaultCustomerGroupsService(em)
}
