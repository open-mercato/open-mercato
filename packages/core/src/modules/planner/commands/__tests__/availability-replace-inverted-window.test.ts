/** @jest-environment node */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SUBJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const WEEKLY_RULE = 'DTSTART:20260105T090000Z\nDURATION:PT1H\nRRULE:FREQ=WEEKLY;BYDAY=MO'
const ONCE_RULE = 'DTSTART:20260615T090000Z\nDURATION:PT1H\nRRULE:FREQ=DAILY;COUNT=1'

const scope = {
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  subjectType: 'member',
  subjectId: SUBJECT_ID,
  timezone: 'UTC',
}

function setup(rrule: string) {
  const rule: { id: string; rrule: string; deletedAt: Date | null } & Record<string, unknown> = {
    ...scope,
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    rrule,
    exdates: [],
    kind: 'availability',
    note: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
  }
  const em = {
    find: jest.fn(async () => [rule]),
    findOne: jest.fn(async () => null),
    create: jest.fn((_cls: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(() => undefined),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async <T>(cb: (trx: unknown) => Promise<T>) => cb(em)),
    fork: () => em,
  }
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({ em: asValue(em) })
  const ctx = {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: null,
  }
  return { rule, em, ctx: ctx as never }
}

const badWindows = [
  ['equal', '09:00', '09:00'],
  ['inverted', '17:00', '09:00'],
  ['out-of-range', '08:00', '24:00'],
]

const invalidWindowError = { status: 400, body: { error: 'planner.availability.errors.invalidWindow' } }

describe('availability replace commands with a window whose end is not after its start', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../availability-weekly')
    await import('../availability-date-specific')
  })

  it.each(badWindows)('weekly replace rejects an %s window and keeps the existing weekly rule', async (_label, start, end) => {
    const { rule, em, ctx } = setup(WEEKLY_RULE)
    const handler = commandRegistry.get('planner.availability.weekly.replace')

    await expect(handler!.execute({ ...scope, windows: [{ weekday: 1, start, end }] }, ctx)).rejects.toMatchObject(invalidWindowError)

    expect(rule.deletedAt).toBeNull()
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it.each(badWindows)('date-specific replace rejects an %s window and keeps the existing rule for that date', async (_label, start, end) => {
    const { rule, em, ctx } = setup(ONCE_RULE)
    const handler = commandRegistry.get('planner.availability.date-specific.replace')
    const input = { ...scope, dates: ['2026-06-15'], kind: 'availability', windows: [{ start, end }] }

    await expect(handler!.execute(input, ctx)).rejects.toMatchObject(invalidWindowError)

    expect(rule.deletedAt).toBeNull()
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('date-specific replace rejects a window that the DST gap inverts on that date', async () => {
    const { rule, em, ctx } = setup(ONCE_RULE)
    const handler = commandRegistry.get('planner.availability.date-specific.replace')
    const input = { ...scope, timezone: 'Europe/Warsaw', dates: ['2026-03-29'], kind: 'availability', windows: [{ start: '02:30', end: '03:30' }] }

    await expect(handler!.execute(input, ctx)).rejects.toMatchObject(invalidWindowError)

    expect(rule.deletedAt).toBeNull()
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('date-specific unavailability still ignores its windows', async () => {
    const { em, ctx } = setup(ONCE_RULE)
    const handler = commandRegistry.get('planner.availability.date-specific.replace')

    await handler!.execute({ ...scope, dates: ['2026-06-15'], kind: 'unavailability', windows: [{ start: '17:00', end: '09:00' }] }, ctx)

    expect(em.create).toHaveBeenCalledTimes(1)
  })

  it('weekly replace still swaps the existing rule for a valid window', async () => {
    const { rule, em, ctx } = setup(WEEKLY_RULE)
    const handler = commandRegistry.get('planner.availability.weekly.replace')

    await handler!.execute({ ...scope, windows: [{ weekday: 1, start: '10:00', end: '12:00' }] }, ctx)

    expect(rule.deletedAt).toBeInstanceOf(Date)
    expect(em.create).toHaveBeenCalledTimes(1)
  })

  it('date-specific replace still swaps the existing rule for a valid window', async () => {
    const { rule, em, ctx } = setup(ONCE_RULE)
    const handler = commandRegistry.get('planner.availability.date-specific.replace')

    await handler!.execute({ ...scope, dates: ['2026-06-15'], kind: 'availability', windows: [{ start: '10:00', end: '12:00' }] }, ctx)

    expect(rule.deletedAt).toBeInstanceOf(Date)
    expect(em.create).toHaveBeenCalledTimes(1)
  })
})
