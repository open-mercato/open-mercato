/** @jest-environment node */
// T4.1 — the read side of the extended time-entry contract.
//
// Two properties are pinned here because both fail silently:
//
//  1. Every entry query is intersected with `resolveProjectAccess`. An entry that
//     names no project has no membership to check, so only the member who logged
//     it may see it — otherwise a consultant reads a colleague's private row.
//  2. Money is ADDED for a caller holding `staff.timesheets.rates.view` and is
//     absent from the payload for everyone else. A `cost` of `0` on a
//     non-billable entry would read as free work rather than out-of-scope work,
//     so it must be `null`.
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'

jest.mock('../../../../lib/time-tracking/access', () => ({
  resolveProjectAccess: jest.fn(),
}))

import { applyResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-runner'
import { registerResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-registry'
import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { buildScopedTimeEntryListFilters, decorateTimeEntryList, RATES_FEATURE } from '../route'
import { enrichers } from '../../../../data/enrichers'
import { resolveProjectAccess } from '../../../../lib/time-tracking/access'
import { StaffTimeEntryTag, StaffTimeProject, StaffTimeTag } from '../../../../data/entities'

const mockResolveProjectAccess = resolveProjectAccess as jest.Mock

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const MEMBER_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_MEMBER_ID = '44444444-4444-4444-8444-4444444444ff'
const MEMBER_PROJECT_ID = '55555555-5555-4555-8555-555555555555'
const FOREIGN_PROJECT_ID = '55555555-5555-4555-8555-5555555555ff'
const ENTRY_ID = '77777777-7777-4777-8777-777777777777'
const TASK_ID = '66666666-6666-4666-8666-666666666666'
const CHILD_TASK_ID = '66666666-6666-4666-8666-6666666666aa'
const TAG_ID = '88888888-8888-4888-8888-000000000001'
const IMPOSSIBLE_ID = '00000000-0000-0000-0000-000000000000'

type Row = Record<string, unknown>

function filterCtx(): CrudCtx {
  return {
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return { fork: () => ({}) }
        // rbacService and moduleConfigService are intentionally unavailable: both
        // lookups must degrade rather than throw.
        throw new Error('[internal] unexpected resolve')
      },
    },
  } as unknown as CrudCtx
}

function asMember(projectIds: string[], staffMemberId: string | null = MEMBER_ID) {
  mockResolveProjectAccess.mockResolvedValue({ canManageAll: false, projectIds, staffMemberId })
}

function asManager() {
  mockResolveProjectAccess.mockResolvedValue({ canManageAll: true, projectIds: [], staffMemberId: MEMBER_ID })
}

const runFilters = (query: Row) => buildScopedTimeEntryListFilters(query as never, filterCtx())

type DecorateWorld = {
  assignments?: { timeEntryId: string; tagId: string }[]
  tags?: { id: string; slug: string; label: string; color: string | null }[]
  projects?: { id: string; hourlyRate: string | null; currencyCode: string | null }[]
}

function decorateCtx(canSeeRates: boolean, world: DecorateWorld = {}): CrudCtx {
  const em = {
    fork: () => em,
    find: async (cls: unknown) => {
      if (cls === StaffTimeEntryTag) return world.assignments ?? []
      if (cls === StaffTimeTag) return world.tags ?? []
      if (cls === StaffTimeProject) return world.projects ?? []
      return []
    },
  }
  return {
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') {
          return {
            userHasAllFeatures: async (_userId: string, features: string[]) =>
              canSeeRates && features.includes(RATES_FEATURE),
          }
        }
        return null
      },
    },
  } as unknown as CrudCtx
}

function entryItem(overrides: Row = {}): Row {
  return {
    id: ENTRY_ID,
    staff_member_id: MEMBER_ID,
    date: '2026-07-01',
    duration_minutes: 61,
    rounded_minutes: 75,
    notes: 'Cart migration',
    time_project_id: MEMBER_PROJECT_ID,
    task_id: null,
    is_billable: true,
    rate_override_amount: null,
    rate_currency_code: 'PLN',
    locked_report_id: null,
    locked_at: null,
    source: 'manual',
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('buildScopedTimeEntryListFilters — project access', () => {
  it('leaves a project manager unnarrowed', async () => {
    asManager()

    await expect(runFilters({})).resolves.toEqual({})
  })

  it('narrows a member to their projects plus their own project-less entries', async () => {
    asMember([MEMBER_PROJECT_ID])

    await expect(runFilters({})).resolves.toEqual({
      $or: [
        { time_project_id: { $in: [MEMBER_PROJECT_ID] } },
        { time_project_id: { $eq: null }, staff_member_id: MEMBER_ID },
      ],
    })
  })

  it('leaves a member with no project able to reach only their own entries', async () => {
    asMember([])

    await expect(runFilters({})).resolves.toEqual({
      $or: [{ time_project_id: { $eq: null }, staff_member_id: MEMBER_ID }],
    })
  })

  it('gives a caller with neither membership nor a staff record nothing at all', async () => {
    asMember([], null)

    await expect(runFilters({})).resolves.toEqual({ id: { $in: [IMPOSSIBLE_ID] } })
  })

  it('keeps the query filters and intersects the access branches with them', async () => {
    asMember([MEMBER_PROJECT_ID])

    await expect(runFilters({ projectId: FOREIGN_PROJECT_ID })).resolves.toEqual({
      time_project_id: FOREIGN_PROJECT_ID,
      $or: [
        { time_project_id: { $in: [MEMBER_PROJECT_ID] } },
        { time_project_id: { $eq: null }, staff_member_id: MEMBER_ID },
      ],
    })
  })

  it('does not let one member reach another member\'s project-less entries', async () => {
    asMember([], OTHER_MEMBER_ID)

    const filters = (await runFilters({ staffMemberId: MEMBER_ID })) as Row
    expect(filters.staff_member_id).toBe(MEMBER_ID)
    expect(filters.$or).toEqual([{ time_project_id: { $eq: null }, staff_member_id: OTHER_MEMBER_ID }])
  })
})

// T3.10 (c) — the task filter. Before it, the drawer's billable / non-billable /
// cost split came from a bounded sweep of the whole PROJECT's entries and had to
// tell the reader the figure was counted from the most recent ones. Asking the
// question directly makes it exact, and the list form answers a parent and its
// subtasks in one request instead of one per child.
describe('buildScopedTimeEntryListFilters — taskId', () => {
  it('narrows to one task', async () => {
    asManager()

    await expect(runFilters({ taskId: TASK_ID })).resolves.toEqual({ task_id: { $in: [TASK_ID] } })
  })

  it('accepts a list so a parent and its subtasks are one request', async () => {
    asManager()

    await expect(runFilters({ taskId: `${TASK_ID}, ${CHILD_TASK_ID}` })).resolves.toEqual({
      task_id: { $in: [TASK_ID, CHILD_TASK_ID] },
    })
  })

  it('keeps the access branches beside the task narrowing rather than instead of them', async () => {
    asMember([MEMBER_PROJECT_ID])

    await expect(runFilters({ taskId: TASK_ID })).resolves.toEqual({
      task_id: { $in: [TASK_ID] },
      $or: [
        { time_project_id: { $in: [MEMBER_PROJECT_ID] } },
        { time_project_id: { $eq: null }, staff_member_id: MEMBER_ID },
      ],
    })
  })

  it('returns nothing at all when the caller can reach no project, whatever task they name', async () => {
    asMember([], null)

    await expect(runFilters({ taskId: TASK_ID })).resolves.toEqual({
      task_id: { $in: [TASK_ID] },
      id: { $in: [IMPOSSIBLE_ID] },
    })
  })

  it('matches nothing rather than failing the query when no id is well-formed', async () => {
    asManager()

    await expect(runFilters({ taskId: 'not-a-uuid' })).resolves.toEqual({ task_id: { $in: [IMPOSSIBLE_ID] } })
  })

  it('drops a malformed id from a list and keeps the rest', async () => {
    asManager()

    await expect(runFilters({ taskId: `${TASK_ID},nonsense,` })).resolves.toEqual({
      task_id: { $in: [TASK_ID] },
    })
  })

  it('leaves the query unnarrowed when no task is named', async () => {
    asManager()

    await expect(runFilters({})).resolves.not.toHaveProperty('task_id')
  })
})

describe('decorateTimeEntryList — response fields', () => {
  it('returns the note under both `notes` and `description`', async () => {
    const items = [entryItem()]
    await decorateTimeEntryList({ items }, decorateCtx(true))

    expect(items[0].notes).toBe('Cart migration')
    expect(items[0].description).toBe('Cart migration')
  })

  it('adds the rounded minutes, lock state and tags', async () => {
    const items = [entryItem({ locked_report_id: '99999999-9999-4999-8999-999999999999' })]
    await decorateTimeEntryList(
      { items },
      decorateCtx(true, {
        assignments: [{ timeEntryId: ENTRY_ID, tagId: TAG_ID }],
        tags: [{ id: TAG_ID, slug: 'dev', label: 'rozwój', color: '#123456' }],
      }),
    )

    expect(items[0]).toMatchObject({
      roundedMinutes: 75,
      isLocked: true,
      lockedReportId: '99999999-9999-4999-8999-999999999999',
      tags: [{ id: TAG_ID, slug: 'dev', label: 'rozwój', color: '#123456' }],
    })
  })

  it('computes cost from the rounded minutes and the project rate', async () => {
    const items = [entryItem()]
    await decorateTimeEntryList(
      { items },
      decorateCtx(true, {
        projects: [{ id: MEMBER_PROJECT_ID, hourlyRate: '320.0000', currencyCode: 'PLN' }],
      }),
    )

    // 75 rounded minutes at 320/h, not the 61 raw minutes.
    expect(items[0].cost).toBe(400)
    expect(items[0].currencyCode).toBe('PLN')
  })

  it('prefers the entry rate override over the project rate', async () => {
    const items = [entryItem({ rate_override_amount: '260' })]
    await decorateTimeEntryList(
      { items },
      decorateCtx(true, {
        projects: [{ id: MEMBER_PROJECT_ID, hourlyRate: '320.0000', currencyCode: 'PLN' }],
      }),
    )

    expect(items[0].cost).toBe(325)
  })

  it('gives a non-billable entry a null cost, never zero', async () => {
    const items = [entryItem({ is_billable: false })]
    await decorateTimeEntryList(
      { items },
      decorateCtx(true, {
        projects: [{ id: MEMBER_PROJECT_ID, hourlyRate: '320.0000', currencyCode: 'PLN' }],
      }),
    )

    expect(items[0].cost).toBeNull()
    expect(items[0].cost).not.toBe(0)
  })

  it('leaves every money key out of the payload without `staff.timesheets.rates.view`', async () => {
    const items = [entryItem({ rate_override_amount: '260' })]
    await decorateTimeEntryList(
      { items },
      decorateCtx(false, {
        projects: [{ id: MEMBER_PROJECT_ID, hourlyRate: '320.0000', currencyCode: 'PLN' }],
      }),
    )

    expect(items[0]).not.toHaveProperty('cost')
    expect(items[0]).not.toHaveProperty('currencyCode')
    expect(items[0]).not.toHaveProperty('rate_override_amount')
    expect(items[0]).not.toHaveProperty('rate_currency_code')
    // The non-money additions still land.
    expect(items[0]).toMatchObject({ roundedMinutes: 75, isLocked: false, description: 'Cart migration' })
  })

  it('falls back to the project currency when the entry carries no snapshot', async () => {
    const items = [entryItem({ rate_currency_code: null })]
    await decorateTimeEntryList(
      { items },
      decorateCtx(true, {
        projects: [{ id: MEMBER_PROJECT_ID, hourlyRate: '320.0000', currencyCode: 'EUR' }],
      }),
    )

    expect(items[0].currencyCode).toBe('EUR')
  })

  it('is a no-op on an empty page', async () => {
    const payload = { items: [] }
    await expect(decorateTimeEntryList(payload, decorateCtx(true))).resolves.toBeUndefined()
  })
})

// EP-14 — the decoration above is no longer a route-private `hooks.afterList`; it is
// the declared `staff.timesheets-time-entries` response enricher. Two things must
// hold after that move, and both fail silently: the rows the endpoint returns must
// look exactly as they did behind the hook, and a third-party enricher registered
// for the same entity must now compose with it instead of being shadowed by it.
describe('the time-entry enricher is the list host', () => {
  const THIRD_PARTY_FIELD = '_jira'

  function enricherContext(canSeeRates: boolean, world: DecorateWorld = {}): EnricherContext {
    const ctx = decorateCtx(canSeeRates, world) as unknown as {
      container: { resolve: (name: string) => unknown }
    }
    return {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      em: ctx.container.resolve('em'),
      container: ctx.container,
    }
  }

  const thirdPartyEnricher: ResponseEnricher<Row & { id: string }, Record<string, unknown>> = {
    id: 'jira.time-entry-issue',
    targetEntity: 'staff:staff_time_entry',
    priority: 1,
    async enrichOne(record) {
      return { ...record, [THIRD_PARTY_FIELD]: { issueKey: `OM-${record.id.slice(0, 4)}` } }
    },
    async enrichMany(records) {
      return Promise.all(records.map((record) => this.enrichOne!(record, {} as EnricherContext)))
    },
  }

  afterEach(() => {
    registerResponseEnrichers([{ moduleId: 'staff', enrichers }])
  })

  it('produces the same row the route-private hook produced', async () => {
    registerResponseEnrichers([{ moduleId: 'staff', enrichers }])
    const world: DecorateWorld = {
      assignments: [{ timeEntryId: ENTRY_ID, tagId: TAG_ID }],
      tags: [{ id: TAG_ID, slug: 'dev', label: 'rozwój', color: '#123456' }],
      projects: [{ id: MEMBER_PROJECT_ID, hourlyRate: '320.0000', currencyCode: 'PLN' }],
    }

    const viaHook = [entryItem()]
    await decorateTimeEntryList({ items: viaHook }, decorateCtx(true, world))

    const viaEnricher = await applyResponseEnrichers(
      [entryItem()],
      'staff:staff_time_entry',
      enricherContext(true, world),
    )

    expect(viaEnricher.items[0]).toEqual(viaHook[0])
    expect(viaEnricher._meta.enrichedBy).toContain('staff.timesheets-time-entries')
  })

  it('lets a third-party enricher add its own fields beside the decoration', async () => {
    registerResponseEnrichers([
      { moduleId: 'staff', enrichers },
      { moduleId: 'jira', enrichers: [thirdPartyEnricher as ResponseEnricher] },
    ])

    const result = await applyResponseEnrichers(
      [entryItem()],
      'staff:staff_time_entry',
      enricherContext(true, {
        projects: [{ id: MEMBER_PROJECT_ID, hourlyRate: '320.0000', currencyCode: 'PLN' }],
      }),
    )

    expect(result.items[0]).toMatchObject({
      description: 'Cart migration',
      roundedMinutes: 75,
      cost: 400,
      [THIRD_PARTY_FIELD]: { issueKey: 'OM-7777' },
    })
    expect(result._meta.enrichedBy).toEqual(
      expect.arrayContaining(['staff.timesheets-time-entries', 'jira.time-entry-issue']),
    )
  })

  it('keeps every money key out of the enriched row without `staff.timesheets.rates.view`', async () => {
    registerResponseEnrichers([
      { moduleId: 'staff', enrichers },
      { moduleId: 'jira', enrichers: [thirdPartyEnricher as ResponseEnricher] },
    ])

    const result = await applyResponseEnrichers(
      [entryItem({ rate_override_amount: '260' })],
      'staff:staff_time_entry',
      enricherContext(false, {
        projects: [{ id: MEMBER_PROJECT_ID, hourlyRate: '320.0000', currencyCode: 'PLN' }],
      }),
    )

    expect(result.items[0]).not.toHaveProperty('cost')
    expect(result.items[0]).not.toHaveProperty('currencyCode')
    expect(result.items[0]).not.toHaveProperty('rate_override_amount')
    expect(result.items[0]).not.toHaveProperty('rate_currency_code')
    expect(result.items[0]).toHaveProperty(THIRD_PARTY_FIELD)
  })
})
