import { resetEnsuredMessagesSchedulesForTests, stableScheduleUuid } from '../../lib/emailRetrySchedule'
import handler, { metadata } from '../ensure-scheduled-release-schedule'

describe('messages:ensure-scheduled-release-schedule', () => {
  beforeEach(() => resetEnsuredMessagesSchedulesForTests())

  it('subscribes persistently to messages.message.scheduled', () => {
    expect(metadata).toEqual({ event: 'messages.message.scheduled', persistent: true, id: 'messages:ensure-scheduled-release-schedule' })
  })

  it('registers the organization release tick once', async () => {
    const register = jest.fn(async () => undefined)
    const ctx = { resolve: jest.fn(() => ({ register })) as never }
    await handler({ tenantId: 't1', organizationId: 'o1' }, ctx)
    await handler({ tenantId: 't1', organizationId: 'o1' }, ctx)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      id: stableScheduleUuid('messages:scheduled-release:o1'),
      targetQueue: 'messages-scheduled-release',
      organizationId: 'o1',
    }))
  })

  it('ignores payloads without a tenant or organization', async () => {
    const register = jest.fn(async () => undefined)
    const ctx = { resolve: jest.fn(() => ({ register })) as never }
    await handler({ organizationId: 'o1' }, ctx)
    await handler({ tenantId: 't1', organizationId: null }, ctx)
    expect(register).not.toHaveBeenCalled()
  })
})
