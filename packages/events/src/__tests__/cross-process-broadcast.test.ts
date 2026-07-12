const publishCrossProcessEventMock = jest.fn(async () => undefined)

jest.mock('../bridge', () => ({
  publishCrossProcessEvent: (...args: unknown[]) => publishCrossProcessEventMock(...args),
  registerCrossProcessEventListener: jest.fn(),
  CROSS_PROCESS_EVENT_INSTANCE_ID: 'test-instance',
}))

import { createModuleEvents } from '@open-mercato/shared/modules/events'
import { createEventBus } from '@open-mercato/events/index'

createModuleEvents({
  moduleId: 'cross_process_test',
  events: [
    { id: 'cross_process_test.browser', label: 'Browser', clientBroadcast: true },
    { id: 'cross_process_test.private', label: 'Private', crossProcessBroadcast: true },
    { id: 'cross_process_test.local', label: 'Local' },
  ] as const,
})

describe('cross-process event publication', () => {
  const resolve = ((name: string) => name) as never

  beforeEach(() => {
    publishCrossProcessEventMock.mockClear()
  })

  it('publishes browser and private cross-process events without changing local events', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    const payload = { id: 'record-1', tenantId: 'tenant-1', organizationId: 'org-1' }

    await bus.emit('cross_process_test.browser', payload)
    await bus.emit('cross_process_test.private', payload)
    await bus.emit('cross_process_test.local', payload)

    expect(publishCrossProcessEventMock).toHaveBeenCalledTimes(2)
    expect(publishCrossProcessEventMock).toHaveBeenNthCalledWith(
      1,
      'cross_process_test.browser',
      payload,
      undefined,
    )
    expect(publishCrossProcessEventMock).toHaveBeenNthCalledWith(
      2,
      'cross_process_test.private',
      payload,
      undefined,
    )
  })

  it('requires trusted tenant payload scope before publishing', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })

    await bus.emit('cross_process_test.private', { id: 'record-1' })

    expect(publishCrossProcessEventMock).not.toHaveBeenCalled()
  })
})
