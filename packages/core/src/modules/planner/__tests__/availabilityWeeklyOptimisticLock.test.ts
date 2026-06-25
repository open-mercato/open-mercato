/** @jest-environment node */

/**
 * Document-aggregate optimistic locking for the weekly availability replace
 * command (#2927).
 *
 * Replacing the weekly hours of a rule set mutates that rule set's child
 * `availability_rules` rows. The parent `PlannerAvailabilityRuleSet` is the
 * consistency boundary: the command guards the parent's `updated_at` (so a
 * stale weekly save loses to a concurrent rule-set change/delete) and bumps it
 * after a successful replace (so a concurrent rule-set delete/update with a
 * stale token conflicts). Strictly additive: no header → no 409.
 */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { PlannerAvailabilityRule, PlannerAvailabilityRuleSet } from '../data/entities'
import '../commands/availability-weekly'

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RULE_SET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const CURRENT = '2026-05-25T08:42:20.999Z'
const STALE = '2026-05-25T08:42:18.123Z'

type RuleSetStub = {
  id: string
  tenantId: string
  organizationId: string
  timezone: string
  updatedAt: Date
  deletedAt: Date | null
}

function makeRuleSet(updatedAt: string): RuleSetStub {
  return {
    id: RULE_SET_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    timezone: 'UTC',
    updatedAt: new Date(updatedAt),
    deletedAt: null,
  }
}

function makeEm(ruleSet: RuleSetStub | null) {
  const em = {
    fork() {
      return em
    },
    transactional: jest.fn(async (cb: (trx: typeof em) => Promise<unknown>) => cb(em)),
    findOne: jest.fn(async (entityClass: unknown) =>
      entityClass === PlannerAvailabilityRuleSet ? ruleSet : null,
    ),
    find: jest.fn(async (entityClass: unknown) =>
      entityClass === PlannerAvailabilityRule ? [] : [],
    ),
    create: jest.fn((_entityClass: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => {}),
  }
  return em
}

function makeCtx(em: ReturnType<typeof makeEm>, headerValue: string | null) {
  const headers = new Headers()
  if (headerValue != null) headers.set(OPTIMISTIC_LOCK_HEADER_NAME, headerValue)
  const request = new Request('https://example.test/api/planner/availability-weekly', {
    method: 'POST',
    headers,
  })
  return {
    container: {
      resolve: (key: string) => {
        if (key === 'em') return em
        throw new Error(`Unexpected resolve(${key})`)
      },
    },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request,
  }
}

function buildInput() {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    subjectType: 'ruleset' as const,
    subjectId: RULE_SET_ID,
    timezone: 'UTC',
    windows: [],
  }
}

describe('planner.availability.weekly.replace — document-aggregate optimistic lock', () => {
  const handler = commandRegistry.get('planner.availability.weekly.replace')

  it('is registered', () => {
    expect(handler).toBeTruthy()
  })

  it('rejects a stale parent rule-set version with a 409 before mutating child rules', async () => {
    const em = makeEm(makeRuleSet(CURRENT))
    const ctx = makeCtx(em, STALE)

    let caught: unknown
    try {
      await handler!.execute(buildInput(), ctx as never)
    } catch (err) {
      caught = err
    }

    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect((caught as CrudHttpError).body).toMatchObject({
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: CURRENT,
      expectedUpdatedAt: STALE,
    })
    // The guard fires before any child-rule work or commit.
    expect(em.find).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('bumps the rule set updated_at when the version matches', async () => {
    const ruleSet = makeRuleSet(CURRENT)
    const em = makeEm(ruleSet)
    const ctx = makeCtx(em, CURRENT)

    const result = await handler!.execute(buildInput(), ctx as never)

    expect(result).toEqual({ ok: true })
    expect(ruleSet.updatedAt.toISOString()).not.toBe(CURRENT)
    expect(em.persist).toHaveBeenCalledWith(ruleSet)
    expect(em.flush).toHaveBeenCalled()
  })

  it('surfaces a 409 when the rule set was deleted concurrently and the client holds a token', async () => {
    const em = makeEm(null)
    const ctx = makeCtx(em, CURRENT)

    let caught: unknown
    try {
      await handler!.execute(buildInput(), ctx as never)
    } catch (err) {
      caught = err
    }

    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect((caught as CrudHttpError).body).toMatchObject({ code: 'optimistic_lock_conflict' })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('is strictly additive: no header → no 409 and the replace proceeds', async () => {
    const ruleSet = makeRuleSet(CURRENT)
    const em = makeEm(ruleSet)
    const ctx = makeCtx(em, null)

    const result = await handler!.execute(buildInput(), ctx as never)

    expect(result).toEqual({ ok: true })
    expect(em.flush).toHaveBeenCalled()
    expect(ruleSet.updatedAt.toISOString()).not.toBe(CURRENT)
  })

  it('still proceeds when a deleted rule set has no client token (legacy behavior)', async () => {
    const em = makeEm(null)
    const ctx = makeCtx(em, null)

    const result = await handler!.execute(buildInput(), ctx as never)

    expect(result).toEqual({ ok: true })
    expect(em.flush).toHaveBeenCalled()
  })
})
