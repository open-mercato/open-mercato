const publishCrossProcessEventMock = jest.fn(async () => undefined)

jest.mock('../bridge', () => ({
  publishCrossProcessEvent: (...args: unknown[]) => publishCrossProcessEventMock(...args),
  registerCrossProcessEventListener: jest.fn(),
  CROSS_PROCESS_EVENT_INSTANCE_ID: 'test-instance',
}))

import { createModuleEvents, setGlobalEventBus } from '@open-mercato/shared/modules/events'
import { createEventBus } from '@open-mercato/events/index'

const testEventsConfig = createModuleEvents({
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
    const trustedScope = { tenantId: 'tenant-1', organizationId: 'org-1' }
    const privateTrustedScope = {
      ...trustedScope,
      emitterModuleId: 'cross_process_test',
    }

    await bus.emit('cross_process_test.browser', payload, trustedScope)
    await bus.emit('cross_process_test.private', payload, privateTrustedScope)
    await bus.emit('cross_process_test.local', payload)

    expect(publishCrossProcessEventMock).toHaveBeenCalledTimes(2)
    expect(publishCrossProcessEventMock).toHaveBeenNthCalledWith(
      1,
      'cross_process_test.browser',
      payload,
      trustedScope,
    )
    expect(publishCrossProcessEventMock).toHaveBeenNthCalledWith(
      2,
      'cross_process_test.private',
      payload,
      privateTrustedScope,
    )
  })

  it('does not treat caller-controlled payload scope as trusted bridge scope', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })

    await bus.emit('cross_process_test.private', {
      id: 'record-1',
      tenantId: 'payload-tenant',
      organizationId: 'payload-org',
    })

    expect(publishCrossProcessEventMock).not.toHaveBeenCalled()
  })

  it('preserves raw EventBus cross-process delivery for declared browser events', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    const payload = {
      id: 'record-1',
      tenantId: ' legacy-tenant ',
      organizationId: ' legacy-org ',
    }

    await bus.emit('cross_process_test.browser', payload)

    expect(publishCrossProcessEventMock).toHaveBeenCalledWith(
      'cross_process_test.browser',
      payload,
      { tenantId: 'legacy-tenant', organizationId: 'legacy-org' },
    )
  })

  it('prefers trusted workflow scope over browser-event payload scope', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    const trustedScope = { tenantId: 'workflow-tenant', organizationId: 'workflow-org' }
    const payload = {
      id: 'record-1',
      tenantId: 'forged-tenant',
      organizationId: 'forged-org',
    }

    await bus.emit('cross_process_test.browser', payload, trustedScope)

    expect(publishCrossProcessEventMock).toHaveBeenCalledWith(
      'cross_process_test.browser',
      payload,
      trustedScope,
    )
  })

  it('publishes from trusted options even when the payload has no scope', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })

    await bus.emit(
      'cross_process_test.private',
      { id: 'record-1' },
      {
        tenantId: 'trusted-tenant',
        organizationId: 'trusted-org',
        emitterModuleId: 'cross_process_test',
      },
    )

    expect(publishCrossProcessEventMock).toHaveBeenCalledWith(
      'cross_process_test.private',
      { id: 'record-1' },
      {
        tenantId: 'trusted-tenant',
        organizationId: 'trusted-org',
        emitterModuleId: 'cross_process_test',
      },
    )
  })

  it('rejects private-event scope without declaring-module provenance', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

    await bus.emit('cross_process_test.private', { id: 'record-1' }, scope)
    await bus.emit('cross_process_test.private', { id: 'record-1' }, {
      ...scope,
      emitterModuleId: 'workflows',
    })

    expect(publishCrossProcessEventMock).not.toHaveBeenCalled()
  })

  it('preserves typed browser-event scope at the trusted module boundary', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    setGlobalEventBus(bus)
    const payload = { id: 'record-1', tenantId: 'tenant-1', organizationId: 'org-1' }

    await testEventsConfig.emit('cross_process_test.browser', payload)

    expect(publishCrossProcessEventMock).toHaveBeenCalledWith(
      'cross_process_test.browser',
      payload,
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        emitterModuleId: 'cross_process_test',
      },
    )
  })

  it('does not promote private-event payload scope at the module boundary', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    setGlobalEventBus(bus)

    await testEventsConfig.emit('cross_process_test.private', {
      id: 'record-1',
      tenantId: 'payload-tenant',
      organizationId: 'payload-org',
    })

    expect(publishCrossProcessEventMock).not.toHaveBeenCalled()
  })
})
