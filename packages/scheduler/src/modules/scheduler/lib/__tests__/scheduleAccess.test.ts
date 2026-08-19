/**
 * Regression test for the manual-trigger 404 on system-scoped schedules.
 *
 * `POST /api/scheduler/trigger` and `GET /api/scheduler/jobs/[id]/executions` used to fold
 * the actor's tenant/org into the lookup, so a schedule with `tenantId === null` and
 * `organizationId === null` never matched and both routes answered 404 — for a super admin
 * too — leaving their own system-scope branch unreachable. This exercises the real
 * `resolveScheduleAccess` both routes now call.
 */

import { describe, it, expect } from '@jest/globals'
import { resolveScheduleAccess, type ScheduleScopeSubject } from '../scheduleAccess'

const systemSchedule: ScheduleScopeSubject = { scopeType: 'system', tenantId: null, organizationId: null }
const tenantSchedule: ScheduleScopeSubject = { scopeType: 'tenant', tenantId: 't1', organizationId: null }
const orgSchedule: ScheduleScopeSubject = { scopeType: 'organization', tenantId: 't1', organizationId: 'o1' }

describe('resolveScheduleAccess — system-scoped schedules', () => {
  it('allows a super admin whose session carries a tenant and an organization', () => {
    expect(
      resolveScheduleAccess(systemSchedule, { tenantId: 't1', orgId: 'o1', isSuperAdmin: true }),
    ).toBe('allowed')
  })

  it('allows a super admin whose session carries no tenant', () => {
    expect(
      resolveScheduleAccess(systemSchedule, { tenantId: null, orgId: null, isSuperAdmin: true }),
    ).toBe('allowed')
  })

  it('forbids a non-super-admin instead of hiding the schedule behind a 404', () => {
    expect(
      resolveScheduleAccess(systemSchedule, { tenantId: 't1', orgId: 'o1', isSuperAdmin: false }),
    ).toBe('forbidden')
  })

  it('forbids an actor missing the isSuperAdmin flag even when a role is named "superadmin"', () => {
    expect(
      resolveScheduleAccess(systemSchedule, { tenantId: 't1', orgId: 'o1' }),
    ).toBe('forbidden')
  })

  it('forbids an unauthenticated-shaped actor', () => {
    expect(resolveScheduleAccess(systemSchedule, null)).toBe('forbidden')
  })
})

/**
 * `ensureCanManageSystemScopedJob` in commands/jobs.ts treats a row as system-scoped when
 * `scopeType === 'system' || tenantId == null`. Update, delete, trigger and executions must
 * not disagree about what a system-scoped row is, so the same test is applied here — including
 * for the inconsistent rows the create validator's scope refinement should never produce.
 */
describe('resolveScheduleAccess — system-scope classification matches commands/jobs.ts', () => {
  it('treats a null tenant as system-scoped even when an organization is set', () => {
    expect(
      resolveScheduleAccess(
        { scopeType: 'organization', tenantId: null, organizationId: 'o1' },
        { tenantId: 't1', orgId: 'o1', isSuperAdmin: false },
      ),
    ).toBe('forbidden')
  })

  it('treats scopeType "system" as system-scoped even when a tenant is set', () => {
    expect(
      resolveScheduleAccess(
        { scopeType: 'system', tenantId: 't1', organizationId: null },
        { tenantId: 't1', orgId: 'o1', isSuperAdmin: false },
      ),
    ).toBe('forbidden')
  })

  it('still classifies by nullability when scopeType is absent', () => {
    expect(
      resolveScheduleAccess({ tenantId: null, organizationId: null }, { tenantId: 't1', isSuperAdmin: false }),
    ).toBe('forbidden')
  })
})

describe('resolveScheduleAccess — tenant isolation', () => {
  it('reports another tenant\'s schedule as not_found, never forbidden', () => {
    expect(
      resolveScheduleAccess(orgSchedule, { tenantId: 't2', orgId: 'o2', isSuperAdmin: false }),
    ).toBe('not_found')
  })

  it('hides another tenant\'s schedule from a super admin scoped to a different tenant', () => {
    expect(
      resolveScheduleAccess(orgSchedule, { tenantId: 't2', orgId: 'o2', isSuperAdmin: true }),
    ).toBe('not_found')
  })

  it('fails closed for a non-super-admin whose tenant could not be resolved', () => {
    expect(
      resolveScheduleAccess(orgSchedule, { tenantId: null, orgId: null, isSuperAdmin: false }),
    ).toBe('not_found')
  })

  // buildSchedulerJobsFilters returns an unmatchable filter when the tenant is falsy, for
  // super admins too, so such an actor cannot see this row in the list either.
  it('fails closed for a super admin whose tenant could not be resolved', () => {
    expect(
      resolveScheduleAccess(orgSchedule, { tenantId: null, orgId: null, isSuperAdmin: true }),
    ).toBe('not_found')
  })
})

describe('resolveScheduleAccess — organization isolation', () => {
  it('reports another organization\'s schedule in the same tenant as not_found', () => {
    expect(
      resolveScheduleAccess(orgSchedule, { tenantId: 't1', orgId: 'o2', isSuperAdmin: false }),
    ).toBe('not_found')
  })

  it('allows the owning organization', () => {
    expect(
      resolveScheduleAccess(orgSchedule, { tenantId: 't1', orgId: 'o1', isSuperAdmin: false }),
    ).toBe('allowed')
  })

  // Inherited from the lookup this helper replaces, which omitted the organization clause
  // entirely when the actor carried no orgId. The list endpoint hides the row in this case
  // (its organization branch needs at least one id), so the two paths disagree. Pinned here
  // to document the divergence, not to endorse it — narrowing it is a separate change.
  it('allows an actor with no selected organization to reach an org-bound schedule in its tenant', () => {
    expect(
      resolveScheduleAccess(orgSchedule, { tenantId: 't1', orgId: null, isSuperAdmin: false }),
    ).toBe('allowed')
  })

  it('keeps a tenant-scoped schedule visible to an org-bound actor in that tenant', () => {
    expect(
      resolveScheduleAccess(tenantSchedule, { tenantId: 't1', orgId: 'o1', isSuperAdmin: false }),
    ).toBe('allowed')
  })

  it('does not treat an undefined organizationId as a distinct organization', () => {
    expect(
      resolveScheduleAccess({ scopeType: 'tenant', tenantId: 't1' }, { tenantId: 't1', orgId: 'o1', isSuperAdmin: false }),
    ).toBe('allowed')
  })
})
