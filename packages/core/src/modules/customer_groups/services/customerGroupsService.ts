import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerGroup, CustomerGroupMembership } from '../data/entities'

export type GroupResolution = {
  groupIds: string[]
  groups: Array<{ id: string; code: string; name: string; kind: string; priority: number }>
}

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
  tenantId: string
  at?: Date
}

export interface CustomerGroupsService {
  resolveGroups(input: ResolveGroupsInput): Promise<GroupResolution>
}

function toGroupSummary(group: CustomerGroup): GroupResolution['groups'][number] {
  return { id: group.id, code: group.code, name: group.name, kind: group.kind, priority: group.priority }
}

function isMembershipValidAt(membership: CustomerGroupMembership, at: Date): boolean {
  if (membership.validFrom && membership.validFrom.getTime() > at.getTime()) return false
  // Inclusive upper bound: a membership expiring exactly at `at` is still valid
  // AT that instant (spec-derived rule — see the module's di.ts contract task).
  if (membership.validUntil && membership.validUntil.getTime() < at.getTime()) return false
  return true
}

export class DefaultCustomerGroupsService implements CustomerGroupsService {
  constructor(private readonly em: EntityManager) {}

  async resolveGroups(input: ResolveGroupsInput): Promise<GroupResolution> {
    const at = input.at ?? new Date()

    if (input.customerId == null) {
      const defaultGroup = await this.em.findOne(CustomerGroup, {
        tenantId: input.tenantId,
        isDefault: true,
        isActive: true,
        deletedAt: null,
      })
      if (!defaultGroup) return { groupIds: [], groups: [] }
      return { groupIds: [defaultGroup.id], groups: [toGroupSummary(defaultGroup)] }
    }

    const memberships = await this.em.find(CustomerGroupMembership, {
      tenantId: input.tenantId,
      customerId: input.customerId,
      deletedAt: null,
    })

    const validMemberships = memberships.filter((membership) => isMembershipValidAt(membership, at))
    if (!validMemberships.length) return { groupIds: [], groups: [] }

    // Precedence rule: when a customer has more than one membership row for the
    // same group (e.g. re-added after a prior removal), the most recently created
    // one is the one whose validity/attribution counts.
    const latestMembershipByGroupId = new Map<string, CustomerGroupMembership>()
    for (const membership of validMemberships) {
      const existing = latestMembershipByGroupId.get(membership.groupId)
      if (!existing || membership.createdAt.getTime() > existing.createdAt.getTime()) {
        latestMembershipByGroupId.set(membership.groupId, membership)
      }
    }

    const groupIds = Array.from(latestMembershipByGroupId.keys())
    const groups = await this.em.find(CustomerGroup, {
      id: { $in: groupIds },
      tenantId: input.tenantId,
      isActive: true,
      deletedAt: null,
    })

    const sortedGroups = groups.slice().sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      const membershipA = latestMembershipByGroupId.get(a.id)!
      const membershipB = latestMembershipByGroupId.get(b.id)!
      return membershipB.createdAt.getTime() - membershipA.createdAt.getTime()
    })

    return {
      groupIds: sortedGroups.map((group) => group.id),
      groups: sortedGroups.map(toGroupSummary),
    }
  }
}

export function createCustomerGroupsService(em: EntityManager): CustomerGroupsService {
  return new DefaultCustomerGroupsService(em)
}
