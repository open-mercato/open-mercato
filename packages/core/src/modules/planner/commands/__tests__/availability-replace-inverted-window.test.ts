/** @jest-environment node */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { ZodError } from 'zod'
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

type ExistingRule = {
  id: string
  tenantId: string
  organizationId: string
  subjectType: string
  subjectId: string
  timezone: string
  rrule: string
  exdates: string[]
  kind: string
  note: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

function makeRule(rrule: string): ExistingRule {
  return {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    subjectType: 'member',
    subjectId: SUBJECT_ID,
    timezone: 'UTC',
    rrule,
    exdates: [],
    kind: 'availability',
    note: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
  }
}

const WEEKLY_RULE = 'DTSTART:20260105T090000Z\nDURATION:PT1H\nRRULE:FREQ=WEEKLY;BYDAY=MO'
const ONCE_RULE = 'DTSTART:20260615T090000Z\nDURATION:PT1H\nRRULE:FREQ=DAILY;COUNT=1'

function makeEm(existing: ExistingRule[]) {
  const em = {
    find: jest.fn(async () => existing),
    findOne: jest.fn(async () => null),
    create: jest.fn((_cls: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(() => undefined),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async <T>(cb: (trx: unknown) => Promise<T>) => cb(em)),
    fork: () => em,
  }
  return em
}

function makeCtx(em: ReturnType<typeof makeEm>) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({ em: asValue(em) })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: null,
  }
}

const scope = {
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  subjectType: 'member',
  subjectId: SUBJECT_ID,
  timezone: 'UTC',
}

describe('availability replace commands — window whose end is not after its start', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../availability-weekly')
    await import('../availability-date-specific')
  })

  it.each([
    ['equal', '09:00', '09:00'],
    ['inverted', '17:00', '09:00'],
    ['out-of-range', '08:00', '24:00'],
  ])('weekly replace rejects an %s window and keeps the existing weekly rule', async (_label, start, end) => {
    const rule = makeRule(WEEKLY_RULE)
    const em = makeEm([rule])
    const handler = commandRegistry.get('planner.availability.weekly.replace')

    await expect(
      handler!.execute({ ...scope, windows: [{ weekday: 1, start, end }] }, makeCtx(em) as never),
    ).rejects.toBeInstanceOf(ZodError)

    expect(rule.deletedAt).toBeNull()
    expect(em.transactional).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
  })

  it.each([
    ['equal', '09:00', '09:00'],
    ['inverted', '17:00', '09:00'],
    ['out-of-range', '08:00', '24:00'],
  ])('date-specific replace rejects an %s window and keeps the existing rule for that date', async (_label, start, end) => {
    const rule = makeRule(ONCE_RULE)
    const em = makeEm([rule])
    const handler = commandRegistry.get('planner.availability.date-specific.replace')

    await expect(
      handler!.execute(
        { ...scope, dates: ['2026-06-15'], kind: 'availability', windows: [{ start, end }] },
        makeCtx(em) as never,
      ),
    ).rejects.toBeInstanceOf(ZodError)

    expect(rule.deletedAt).toBeNull()
    expect(em.transactional).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('weekly replace still swaps the existing rule for a valid window', async () => {
    const rule = makeRule(WEEKLY_RULE)
    const em = makeEm([rule])
    const handler = commandRegistry.get('planner.availability.weekly.replace')

    await handler!.execute({ ...scope, windows: [{ weekday: 1, start: '10:00', end: '12:00' }] }, makeCtx(em) as never)

    expect(rule.deletedAt).toBeInstanceOf(Date)
    expect(em.create).toHaveBeenCalledTimes(1)
  })
})
