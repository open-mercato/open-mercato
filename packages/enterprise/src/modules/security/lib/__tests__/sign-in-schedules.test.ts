import { registerSignInSchedules } from '../sign-in-schedules'

test('repeated registration upserts one global retention and one recovery schedule', async () => {
  const register = jest.fn()
  const scheduler = { register }
  const container = { hasRegistration: () => true, resolve: () => scheduler }

  await registerSignInSchedules(container)
  await registerSignInSchedules(container)

  expect(register.mock.calls[0][0]).toEqual(register.mock.calls[2][0])
  expect(register.mock.calls[1][0]).toEqual(register.mock.calls[3][0])
  expect(register).toHaveBeenNthCalledWith(1, expect.objectContaining({
    scopeType: 'system',
    scheduleType: 'cron',
    scheduleValue: '15 3 * * *',
    targetQueue: 'security-sign-in-retention',
  }))
  expect(register).toHaveBeenNthCalledWith(2, expect.objectContaining({
    scopeType: 'system',
    targetQueue: 'security-sign-in-notification',
  }))
})

test('scheduler is optional', async () => {
  const resolve = jest.fn()
  await registerSignInSchedules({ hasRegistration: () => false, resolve })
  expect(resolve).not.toHaveBeenCalled()
})
