import {
  ensureMessagesEmailRetrySchedule,
  resetEnsuredMessagesSchedulesForTests,
  stableScheduleUuid,
} from '../emailRetrySchedule'

function sourceWith(register: jest.Mock) {
  return { resolve: jest.fn((name: string) => (name === 'schedulerService' ? { register } : undefined)) }
}

describe('ensureMessagesEmailRetrySchedule', () => {
  beforeEach(() => resetEnsuredMessagesSchedulesForTests())

  it('registers the per-organization retry tick once per process', async () => {
    const register = jest.fn(async () => undefined)
    const source = sourceWith(register)
    await ensureMessagesEmailRetrySchedule(source, { tenantId: 't1', organizationId: 'o1' })
    await ensureMessagesEmailRetrySchedule(source, { tenantId: 't1', organizationId: 'o1' })
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      id: stableScheduleUuid('messages:email-retry-tick:o1'),
      targetQueue: 'messages-email-retry',
      organizationId: 'o1',
      tenantId: 't1',
      sourceType: 'module',
    }))
  })

  it('skips organization-less scopes and a missing scheduler, and retries after a failed registration', async () => {
    const register = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined)
    const source = sourceWith(register)
    await ensureMessagesEmailRetrySchedule(source, { tenantId: 't1', organizationId: null })
    await ensureMessagesEmailRetrySchedule({ resolve: () => { throw new Error('not registered') } }, { tenantId: 't1', organizationId: 'o1' })
    expect(register).not.toHaveBeenCalled()
    await expect(ensureMessagesEmailRetrySchedule(source, { tenantId: 't1', organizationId: 'o1' })).resolves.toBeUndefined()
    await ensureMessagesEmailRetrySchedule(source, { tenantId: 't1', organizationId: 'o1' })
    expect(register).toHaveBeenCalledTimes(2)
  })
})
