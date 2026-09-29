/** @jest-environment node */
// Coverage for D-3 of the time tracking consulting suite spec: a project's
// currency is read-only once hours are logged, and the deliberate change action
// RELABELS without converting. These tests pin the three properties that make
// the relabel safe to ship: it refuses while entries sit frozen in a closed
// report (naming the blocking reports), it leaves every historical amount and
// `rate_currency_code` untouched, and it never reaches outside the caller's
// tenant/organization scope.
import type { AwilixContainer } from 'awilix'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'

const mockFindOneWithDecryption = jest.fn()
const mockEmitCrudSideEffects = jest.fn()

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn((...args: unknown[]) => mockEmitCrudSideEffects(...args)),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const REPORT_ID = '55555555-5555-4555-8555-555555555555'

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

type LoadedCommand = {
  command: RegisteredCommand
  StaffTimeEntry: unknown
  StaffTimeReport: unknown
  StaffTimeProject: unknown
}

async function loadChangeCurrencyCommand(): Promise<LoadedCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-projects')
  const entities = await import('../../data/entities')
  return {
    command: commandRegistry.get('staff.timesheets.time_projects.change_currency') as RegisteredCommand,
    StaffTimeEntry: entities.StaffTimeEntry,
    StaffTimeReport: entities.StaffTimeReport,
    StaffTimeProject: entities.StaffTimeProject,
  }
}

type FindCall = { cls: unknown; where: Record<string, unknown> }

function makeProject() {
  return {
    id: PROJECT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    name: 'Consulting retainer',
    code: 'CONS',
    status: 'active',
    currencyCode: 'PLN',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

/**
 * Two historical entries carrying their own frozen rate currency and cost. The
 * relabel must not touch either — that is the whole point of "relabel without
 * converting".
 */
function makeHistoricalEntries() {
  return [
    { id: 'entry-1', timeProjectId: PROJECT_ID, rateCurrencyCode: 'PLN', rateAmount: '250.0000', lockedReportId: null },
    { id: 'entry-2', timeProjectId: PROJECT_ID, rateCurrencyCode: 'PLN', rateAmount: '180.0000', lockedReportId: null },
  ]
}

function makeEm(options: {
  StaffTimeEntry: unknown
  StaffTimeReport: unknown
  lockedEntries?: Array<Record<string, unknown>>
  reports?: Array<Record<string, unknown>>
  findCalls: FindCall[]
}) {
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    find: jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
      options.findCalls.push({ cls, where })
      if (cls === options.StaffTimeEntry) return options.lockedEntries ?? []
      if (cls === options.StaffTimeReport) return options.reports ?? []
      return []
    }),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
  }
  em.fork.mockReturnValue(em)
  return em
}

function createCtx(em: unknown) {
  return {
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return null
        return null
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: [ORG_ID],
  }
}

function changeInput(overrides: Record<string, unknown> = {}) {
  return { id: PROJECT_ID, currencyCode: 'EUR', acknowledged: true, ...overrides }
}

describe('staff.timesheets.time_projects.change_currency (D-3)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEmitCrudSideEffects.mockResolvedValue(undefined)
  })

  it('relabels the project currency without converting any historical amount', async () => {
    const { command, StaffTimeEntry, StaffTimeReport } = await loadChangeCurrencyCommand()
    expect(command).toBeTruthy()
    const project = makeProject()
    const entries = makeHistoricalEntries()
    const entriesBefore = JSON.parse(JSON.stringify(entries))
    mockFindOneWithDecryption.mockResolvedValue(project)
    const findCalls: FindCall[] = []
    const em = makeEm({ StaffTimeEntry, StaffTimeReport, findCalls })

    const result = (await command.execute(changeInput(), createCtx(em))) as {
      timeProjectId: string
      currencyCode: string
      previousCurrencyCode: string | null
    }

    expect(result).toEqual({
      timeProjectId: PROJECT_ID,
      currencyCode: 'EUR',
      previousCurrencyCode: 'PLN',
    })
    expect(project.currencyCode).toBe('EUR')
    // The write commits inside one transaction, and the lock probe never shares a
    // phase with the scalar mutation.
    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()

    // Nothing on the entries was read for writing, and nothing was mutated: no
    // cost recompute, no `rate_currency_code` rewrite.
    expect(entries).toEqual(entriesBefore)
  })

  it('emits staff.timesheets.time_project.updated with the currency transition in the payload', async () => {
    const { command, StaffTimeEntry, StaffTimeReport } = await loadChangeCurrencyCommand()
    mockFindOneWithDecryption.mockResolvedValue(makeProject())
    const findCalls: FindCall[] = []
    const em = makeEm({ StaffTimeEntry, StaffTimeReport, findCalls })

    await command.execute(changeInput(), createCtx(em))

    expect(mockEmitCrudSideEffects).toHaveBeenCalledTimes(1)
    const emitted = mockEmitCrudSideEffects.mock.calls[0][0] as {
      action: string
      events: CrudEventsConfig<unknown>
      indexer: { entityType: string }
    }
    expect(emitted.action).toBe('updated')
    expect(emitted.events.module).toBe('staff')
    expect(emitted.events.entity).toBe('timesheets.time_project')
    expect(emitted.indexer.entityType).toBe('staff:staff_time_project')
    const payload = emitted.events.buildPayload?.({
      action: 'updated',
      entity: null,
      identifiers: { id: PROJECT_ID, organizationId: ORG_ID, tenantId: TENANT_ID },
    })
    expect(payload).toEqual({
      id: PROJECT_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      changedField: 'currencyCode',
      previousCurrencyCode: 'PLN',
      currencyCode: 'EUR',
      converted: false,
    })
  })

  it('refuses with 409 project_has_locked_entries and names the blocking reports', async () => {
    const { command, StaffTimeEntry, StaffTimeReport } = await loadChangeCurrencyCommand()
    const project = makeProject()
    mockFindOneWithDecryption.mockResolvedValue(project)
    const findCalls: FindCall[] = []
    const em = makeEm({
      StaffTimeEntry,
      StaffTimeReport,
      lockedEntries: [
        { id: 'entry-1', lockedReportId: REPORT_ID },
        { id: 'entry-2', lockedReportId: REPORT_ID },
      ],
      reports: [{ id: REPORT_ID, reference: 'TR-2026-04', title: 'April retainer' }],
      findCalls,
    })

    await expect(command.execute(changeInput(), createCtx(em))).rejects.toMatchObject({
      status: 409,
      body: {
        code: 'project_has_locked_entries',
        lockedEntryCount: 2,
        lockedReports: [{ id: REPORT_ID, reference: 'TR-2026-04', title: 'April retainer' }],
      },
    })

    // Refused means refused: the currency is untouched and the transaction rolled back.
    expect(project.currencyCode).toBe('PLN')
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(mockEmitCrudSideEffects).not.toHaveBeenCalled()
  })

  it('scopes the project lookup and the lock probe to the caller tenant and organization', async () => {
    const { command, StaffTimeEntry, StaffTimeReport } = await loadChangeCurrencyCommand()
    mockFindOneWithDecryption.mockResolvedValue(makeProject())
    const findCalls: FindCall[] = []
    const em = makeEm({ StaffTimeEntry, StaffTimeReport, findCalls })

    await command.execute(changeInput(), createCtx(em))

    const lookupWhere = mockFindOneWithDecryption.mock.calls[0][2] as Record<string, unknown>
    expect(lookupWhere).toMatchObject({ id: PROJECT_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null })

    const entryProbe = findCalls.find((call) => call.cls === StaffTimeEntry)
    expect(entryProbe?.where).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      timeProjectId: PROJECT_ID,
      deletedAt: null,
    })
  })

  it('returns 404 for a project outside the caller tenant', async () => {
    const { command, StaffTimeEntry, StaffTimeReport } = await loadChangeCurrencyCommand()
    // The tenant-scoped where clause filters the foreign project out entirely.
    mockFindOneWithDecryption.mockResolvedValue(null)
    const findCalls: FindCall[] = []
    const em = makeEm({ StaffTimeEntry, StaffTimeReport, findCalls })

    await expect(
      command.execute(changeInput(), {
        ...createCtx(em),
        auth: { sub: 'user-1', tenantId: OTHER_TENANT_ID, orgId: ORG_ID },
      }),
    ).rejects.toMatchObject({ status: 404 })

    expect(em.begin).not.toHaveBeenCalled()
    expect(mockEmitCrudSideEffects).not.toHaveBeenCalled()
  })

  it('rejects a body without the acknowledged literal', async () => {
    const { command, StaffTimeEntry, StaffTimeReport } = await loadChangeCurrencyCommand()
    mockFindOneWithDecryption.mockResolvedValue(makeProject())
    const findCalls: FindCall[] = []
    const em = makeEm({ StaffTimeEntry, StaffTimeReport, findCalls })

    await expect(
      command.execute({ id: PROJECT_ID, currencyCode: 'EUR' }, createCtx(em)),
    ).rejects.toBeInstanceOf(Error)
    expect(em.begin).not.toHaveBeenCalled()
  })
})
