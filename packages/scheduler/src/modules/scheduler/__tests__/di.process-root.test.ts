import { asValue, createContainer } from 'awilix'
import { getProcessDiRegistrar, runCallerSetups } from '@open-mercato/shared/lib/di/process-registrar'

jest.mock('../services/bullmqSchedulerService.js', () => ({
  BullMQSchedulerService: jest.fn().mockImplementation((em) => ({
    em, syncAll: jest.fn(async () => undefined), destroy: jest.fn(async () => undefined),
  })),
}))
jest.mock('../services/localSchedulerService.js', () => ({
  LocalSchedulerService: jest.fn().mockImplementation((em, queueFactory, rbacService) => ({
    em, queueFactory, rbacService, stop: jest.fn(async () => undefined),
  })),
}))
jest.mock('../services/schedulerService.js', () => ({
  SchedulerService: jest.fn().mockImplementation((em, bullmqService) => ({ em, bullmqService })),
}))
jest.mock('../lib/scheduledJobSubscriber.js', () => ({
  ScheduledJobSubscriber: jest.fn().mockImplementation(() => ({ setContainer: jest.fn() })),
}))

import { register } from '../di'
import { BullMQSchedulerService } from '../services/bullmqSchedulerService'

const originalStrategy = process.env.QUEUE_STRATEGY

afterEach(() => {
  if (originalStrategy === undefined) delete process.env.QUEUE_STRATEGY
  else process.env.QUEUE_STRATEGY = originalStrategy
  jest.clearAllMocks()
})

it('registers local services without eager scope resolution and binds them to each caller', async () => {
  process.env.QUEUE_STRATEGY = 'local'
  const root = createContainer()
  const rootResolve = jest.spyOn(root, 'resolve')
  await getProcessDiRegistrar(register)!(root)
  expect(rootResolve).not.toHaveBeenCalled()
  const callers = [root.createScope(), root.createScope()]
  for (const [index, caller] of callers.entries()) {
    const em = { label: index }
    const rbac = { label: index }
    caller.register({ em: asValue(em), rbacService: asValue(rbac) })
    const local = caller.resolve<{ em: () => unknown; rbacService: unknown }>('localSchedulerService')
    expect(local.em()).toBe(em)
    expect(local.rbacService).toBe(rbac)
    expect(caller.resolve<{ em: () => unknown }>('schedulerService').em()).toBe(em)
  }
  expect(callers[0].resolve('localSchedulerService')).not.toBe(callers[1].resolve('localSchedulerService'))
})

it('attaches each async subscriber to its own caller and synchronizes once without a timer', async () => {
  process.env.QUEUE_STRATEGY = 'async'
  const root = createContainer()
  const timer = jest.spyOn(global, 'setImmediate')
  try {
    await getProcessDiRegistrar(register)!(root)
    const callers = [root.createScope(), root.createScope()]
    for (const caller of callers) {
      const registerSubscriber = jest.fn()
      const em = { getEventManager: () => ({ registerSubscriber }) }
      caller.register({ em: asValue(em) })
      await runCallerSetups(root, caller)
      expect(registerSubscriber).toHaveBeenCalledTimes(1)
      expect(registerSubscriber.mock.calls[0][0].setContainer).toHaveBeenCalledWith(caller)
      const service = caller.resolve<{ em: () => unknown }>('bullmqSchedulerService')
      expect(service.em()).toBe(em)
    }
    expect(timer).not.toHaveBeenCalled()
    const instances = jest.mocked(BullMQSchedulerService).mock.results.map(({ value }) => value)
    expect(instances[0].syncAll).toHaveBeenCalledTimes(1)
    expect(instances[1].syncAll).not.toHaveBeenCalled()
    await Promise.all(callers.map((caller) => caller.dispose()))
    for (const instance of instances) expect(instance.destroy).toHaveBeenCalledTimes(1)
  } finally {
    timer.mockRestore()
  }
})
