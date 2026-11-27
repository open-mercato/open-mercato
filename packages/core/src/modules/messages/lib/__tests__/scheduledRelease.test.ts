import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely'
import { buildClaimDueScheduledMessagesQuery, type ScheduledReleaseDatabase } from '../scheduledRelease'
import {
  registerMessagesScheduledReleaseSchedule,
  MESSAGES_SCHEDULED_RELEASE_QUEUE_NAME,
  SCHEDULED_RELEASE_LEASE_MINUTES,
  isSchedulingAvailable,
  isSchedulingAvailableFor,
} from '../scheduledSend'
import { getScheduleMaxDays } from '../scheduleLimits'

const db = new Kysely<ScheduledReleaseDatabase>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (instance) => new PostgresIntrospector(instance),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
})

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'

describe('claim of due scheduled messages', () => {
  it('moves due scheduled rows of one organization to releasing in a single bounded UPDATE ... RETURNING', () => {
    const { sql, parameters } = buildClaimDueScheduledMessagesQuery(db, { tenantId, organizationId }).compile()
    expect(sql).toMatch(/^update "messages" set "status" = \$\d+, "updated_at" = now\(\), "scheduled_release_attempts" = scheduled_release_attempts \+ 1/)
    expect(sql).not.toContain('"sent_at"')
    expect(sql).not.toContain('"is_draft"')
    expect(sql).toContain('"scheduled_at" <= now()')
    expect(sql).toMatch(/"updated_at" < now\(\) - make_interval\(mins => \$\d+\)/)
    expect(sql).toMatch(/"status" in \(\$\d+, \$\d+\)/)
    expect(parameters).toEqual(expect.arrayContaining(['releasing', 'scheduled', SCHEDULED_RELEASE_LEASE_MINUTES]))
    expect(sql).toContain('"tenant_id" = $')
    expect(sql).toContain('"organization_id" = $')
    expect(sql).toContain('"deleted_at" is null')
    expect(sql).toContain('for update skip locked')
    expect(sql).toMatch(/returning "id", "scheduled_at", "scheduled_release_attempts"$/)
    expect(parameters).toEqual(expect.arrayContaining([tenantId, organizationId, 100]))
  })

  it('scopes an organization-less tenant to organization_id IS NULL', () => {
    const { sql, parameters } = buildClaimDueScheduledMessagesQuery(db, { tenantId, organizationId: null }).compile()
    expect(sql).toContain('"organization_id" is null')
    expect(parameters).not.toContain(organizationId)
  })
})

describe('scheduled release schedule registration', () => {
  it('registers a module-owned 60s interval per organization when the scheduler exists', async () => {
    const register = jest.fn(async () => {})
    const container = {
      hasRegistration: (name: string) => name === 'schedulerService',
      resolve: () => ({ register }),
    }
    await registerMessagesScheduledReleaseSchedule(container as never, { tenantId, organizationId })
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      scopeType: 'organization',
      tenantId,
      organizationId,
      scheduleType: 'interval',
      scheduleValue: '60s',
      targetType: 'queue',
      targetQueue: MESSAGES_SCHEDULED_RELEASE_QUEUE_NAME,
      targetPayload: { scope: { tenantId, organizationId } },
      sourceType: 'module',
      sourceModule: 'messages',
    }))
  })

  it('offers scheduling only to a caller with an organization, whose release tick exists', () => {
    const withScheduler = { hasRegistration: (name: string) => name === 'schedulerService' }
    expect(isSchedulingAvailableFor(withScheduler, organizationId)).toBe(true)
    expect(isSchedulingAvailableFor(withScheduler, null)).toBe(false)
    expect(isSchedulingAvailableFor({}, organizationId)).toBe(false)
  })

  it('is a no-op without the scheduler', async () => {
    const resolve = jest.fn()
    await registerMessagesScheduledReleaseSchedule({ hasRegistration: () => false, resolve } as never, { tenantId, organizationId })
    expect(resolve).not.toHaveBeenCalled()
    expect(isSchedulingAvailable({})).toBe(false)
  })
})

describe('OM_MESSAGES_SCHEDULE_MAX_DAYS', () => {
  const previous = process.env.OM_MESSAGES_SCHEDULE_MAX_DAYS
  afterEach(() => {
    if (previous === undefined) delete process.env.OM_MESSAGES_SCHEDULE_MAX_DAYS
    else process.env.OM_MESSAGES_SCHEDULE_MAX_DAYS = previous
  })

  it.each([[undefined, 30], ['7', 7], ['0', 30], ['abc', 30], ['-3', 30]])('reads %p as %p', (raw, expected) => {
    if (raw === undefined) delete process.env.OM_MESSAGES_SCHEDULE_MAX_DAYS
    else process.env.OM_MESSAGES_SCHEDULE_MAX_DAYS = raw
    expect(getScheduleMaxDays()).toBe(expected)
  })
})
