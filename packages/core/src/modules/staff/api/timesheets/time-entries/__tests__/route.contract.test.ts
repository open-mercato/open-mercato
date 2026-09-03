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
import {
  buildScopedTimeEntryListFilters,
  decorateTimeEntryList,
  RATES_FEATURE,
  timeEntryListFields,
} from '../route'
import { enrichers } from '../../../../data/enrichers'
import { resolveProjectAccess } from '../../../../lib/time-tracking/access'
import { StaffTimeEntry, StaffTimeEntryTag, StaffTimeProject, StaffTimeTag } from '../../../../data/entities'

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
const LOCKED_REPORT_ID = '99999999-9999-4999-8999-999999999999'
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
  /**
   * `staff_time_entries` rows the enricher reads back for an entitled caller. The
   * two money columns are NOT in the route's projection, so this is the only place
   * a rate override can come from.
   */
  entries?: { id: string; rateOverrideAmount: string | null; rateCurrencyCode: string | null }[]
  /** Every query hangs — the shape of a database slow enough to blow the timeout. */
  stall?: boolean
}

function pricedProject(hourlyRate: string | null, currencyCode: string | null) {
  return { id: MEMBER_PROJECT_ID, hourlyRate, currencyCode }
}

function decorateCtx(canSeeRates: boolean, world: DecorateWorld = {}): CrudCtx {
  const em = {
    fork: () => em,
    find: async (cls: unknown) => {
      if (world.stall) return new Promise<never[]>(() => {})
      if (cls === StaffTimeEntryTag) return world.assignments ?? []
      if (cls === StaffTimeTag) return world.tags ?? []
      if (cls === StaffTimeProject) return world.projects ?? []
      if (cls === StaffTimeEntry) return world.entries ?? []
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

// EP-14 — the decoration is no longer a route-private `hooks.afterList`; it is the
// declared `staff.timesheets-time-entries` response enricher, and that enricher is
// the path `/api/staff/timesheets/time-entries` actually runs. So these assertions
// drive `applyResponseEnrichers`; the route's own `decorateTimeEntryList` export
// survives only as a deprecated wrapper and is pinned separately at the bottom.
//
// Three properties are pinned here because all three fail silently:
//
//  1. the rows the endpoint returns look exactly as they did behind the hook;
//  2. a third-party enricher registered for the same entity composes with the
//     decoration instead of being shadowed by it;
//  3. **money is ADDED by the enricher, never subtracted by it.** The enricher is
//     `critical: false`, so a throw or a timeout leaves the runner's items
//     untouched — a subtractive gate would hand every money column to an
//     unentitled caller the first time the database was slow.
describe('the time-entry enricher — response fields', () => {
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
    } as unknown as EnricherContext
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

  async function enrich(canSeeRates: boolean, items: Row[], world: DecorateWorld = {}) {
    registerResponseEnrichers([{ moduleId: 'staff', enrichers }])
    return applyResponseEnrichers(items, 'staff:staff_time_entry', enricherContext(canSeeRates, world))
  }

  afterEach(() => {
    registerResponseEnrichers([{ moduleId: 'staff', enrichers }])
  })

  it('returns the note under both `notes` and `description`', async () => {
    const result = await enrich(true, [entryItem()])

    expect(result.items[0].notes).toBe('Cart migration')
    expect(result.items[0].description).toBe('Cart migration')
  })

  it('adds the rounded minutes, lock state and tags', async () => {
    const result = await enrich(true, [entryItem({ locked_report_id: LOCKED_REPORT_ID })], {
      assignments: [{ timeEntryId: ENTRY_ID, tagId: TAG_ID }],
      tags: [{ id: TAG_ID, slug: 'dev', label: 'rozwój', color: '#123456' }],
    })

    expect(result.items[0]).toMatchObject({
      roundedMinutes: 75,
      isLocked: true,
      lockedReportId: LOCKED_REPORT_ID,
      tags: [{ id: TAG_ID, slug: 'dev', label: 'rozwój', color: '#123456' }],
    })
  })

  it('computes cost from the rounded minutes and the project rate', async () => {
    const result = await enrich(true, [entryItem()], { projects: [pricedProject('320.0000', 'PLN')] })

    // 75 rounded minutes at 320/h, not the 61 raw minutes.
    expect(result.items[0].cost).toBe(400)
    expect(result.items[0].currencyCode).toBe('PLN')
  })

  it('reads the stored rate override back for an entitled caller and prefers it over the project rate', async () => {
    const result = await enrich(true, [entryItem()], {
      projects: [pricedProject('320.0000', 'PLN')],
      entries: [{ id: ENTRY_ID, rateOverrideAmount: '260', rateCurrencyCode: 'PLN' }],
    })

    // The column is not in the base projection — the enricher fetched it.
    expect(result.items[0].rate_override_amount).toBe('260')
    expect(result.items[0].cost).toBe(325)
  })

  it('gives a non-billable entry a null cost, never zero', async () => {
    const result = await enrich(true, [entryItem({ is_billable: false })], {
      projects: [pricedProject('320.0000', 'PLN')],
    })

    expect(result.items[0].cost).toBeNull()
    expect(result.items[0].cost).not.toBe(0)
  })

  it('leaves every money key out of the payload without `staff.timesheets.rates.view`', async () => {
    const result = await enrich(false, [entryItem()], {
      projects: [pricedProject('320.0000', 'PLN')],
      entries: [{ id: ENTRY_ID, rateOverrideAmount: '260', rateCurrencyCode: 'PLN' }],
    })

    expect(result.items[0]).not.toHaveProperty('cost')
    expect(result.items[0]).not.toHaveProperty('currencyCode')
    expect(result.items[0]).not.toHaveProperty('rate_override_amount')
    expect(result.items[0]).not.toHaveProperty('rate_currency_code')
    // The non-money additions still land.
    expect(result.items[0]).toMatchObject({ roundedMinutes: 75, isLocked: false, description: 'Cart migration' })
  })

  it('falls back to the project currency when the entry carries no snapshot', async () => {
    const result = await enrich(true, [entryItem()], {
      projects: [pricedProject('320.0000', 'EUR')],
      entries: [{ id: ENTRY_ID, rateOverrideAmount: null, rateCurrencyCode: null }],
    })

    expect(result.items[0].currencyCode).toBe('EUR')
  })

  it('is a no-op on an empty page', async () => {
    const result = await enrich(true, [])

    expect(result.items).toEqual([])
  })

  it('lets a third-party enricher add its own fields beside the decoration', async () => {
    registerResponseEnrichers([
      { moduleId: 'staff', enrichers },
      { moduleId: 'jira', enrichers: [thirdPartyEnricher as ResponseEnricher] },
    ])

    const result = await applyResponseEnrichers(
      [entryItem()],
      'staff:staff_time_entry',
      enricherContext(true, { projects: [pricedProject('320.0000', 'PLN')] }),
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
      [entryItem()],
      'staff:staff_time_entry',
      enricherContext(false, {
        projects: [pricedProject('320.0000', 'PLN')],
        entries: [{ id: ENTRY_ID, rateOverrideAmount: '260', rateCurrencyCode: 'PLN' }],
      }),
    )

    expect(result.items[0]).not.toHaveProperty('cost')
    expect(result.items[0]).not.toHaveProperty('currencyCode')
    expect(result.items[0]).not.toHaveProperty('rate_override_amount')
    expect(result.items[0]).not.toHaveProperty('rate_currency_code')
    expect(result.items[0]).toHaveProperty(THIRD_PARTY_FIELD)
  })
})

// B-1 — the money gate must survive the enricher not running at all.
//
// `staff.timesheets-time-entries` is `critical: false` with no `fallback`, and
// `enricher-runner.ts` leaves `currentItems` untouched when such an enricher throws
// or exceeds its timeout. Anything the route's own projection selects therefore
// reaches the client whatever the enricher does — which is why the projection
// selects no money column and the enricher adds them instead.
describe('the money gate when the enricher never completes', () => {
  it('selects no money column in the base projection', () => {
    expect(timeEntryListFields).not.toContain('rate_override_amount')
    expect(timeEntryListFields).not.toContain('rate_currency_code')
  })

  it('serves a page with no money at all when the enricher times out', async () => {
    jest.useFakeTimers()
    try {
      registerResponseEnrichers([{ moduleId: 'staff', enrichers }])
      const ctx = decorateCtx(true, {
        stall: true,
        projects: [pricedProject('320.0000', 'PLN')],
        entries: [{ id: ENTRY_ID, rateOverrideAmount: '260', rateCurrencyCode: 'PLN' }],
      }) as unknown as { container: { resolve: (name: string) => unknown } }

      const pending = applyResponseEnrichers([entryItem()], 'staff:staff_time_entry', {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        em: ctx.container.resolve('em'),
        container: ctx.container,
      } as unknown as EnricherContext)

      // Past the enricher's declared 3000 ms budget.
      await jest.advanceTimersByTimeAsync(3100)
      const result = await pending

      expect(result._meta.enricherErrors).toContain('staff.timesheets-time-entries')
      expect(result.items[0]).not.toHaveProperty('cost')
      expect(result.items[0]).not.toHaveProperty('currencyCode')
      expect(result.items[0]).not.toHaveProperty('rate_override_amount')
      expect(result.items[0]).not.toHaveProperty('rate_currency_code')
      expect(result.items[0]).toEqual(entryItem())
    } finally {
      jest.useRealTimers()
    }
  })
})

// The route still exports `decorateTimeEntryList` as a deprecated wrapper over the
// same shared decoration. It is a published symbol of the route module, so it keeps
// working; it is simply no longer the path the endpoint runs.
describe('decorateTimeEntryList — the deprecated route wrapper', () => {
  it('still decorates the rows it is handed', async () => {
    const items = [entryItem()]
    await decorateTimeEntryList({ items }, decorateCtx(true, { projects: [pricedProject('320.0000', 'PLN')] }))

    expect(items[0]).toMatchObject({ description: 'Cart migration', roundedMinutes: 75, cost: 400 })
  })

  it('is a no-op on an empty page', async () => {
    const payload = { items: [] }
    await expect(decorateTimeEntryList(payload, decorateCtx(true))).resolves.toBeUndefined()
  })
})
