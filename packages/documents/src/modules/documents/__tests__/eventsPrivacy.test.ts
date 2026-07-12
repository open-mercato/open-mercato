import {
  getDeclaredEvents,
  isBroadcastEvent,
  isEventDeclared,
  setGlobalEventBus,
} from '@open-mercato/shared/modules/events'
import eventsConfig, { emitDocumentsEvent } from '../events'

describe('Documents events privacy contract', () => {
  afterEach(() => {
    setGlobalEventBus({ emit: async () => undefined })
  })

  it('broadcasts only document lifecycle changes needed by live clients', () => {
    expect(eventsConfig.moduleId).toBe('documents')
    expect(eventsConfig.events).not.toHaveLength(0)

    for (const event of eventsConfig.events) {
      expect(event.id).toMatch(/^documents\./)
    }
    const broadcastIds = eventsConfig.events
      .filter((event) => event.clientBroadcast === true)
      .map((event) => event.id)

    expect(broadcastIds).toEqual([
      'documents.document.updated',
      'documents.document.deleted',
      'documents.document.shared',
      'documents.document.unshared',
      'documents.version.restored',
    ])
    for (const event of eventsConfig.events) {
      expect(isBroadcastEvent(event.id)).toBe(broadcastIds.includes(event.id))
    }
  })

  it('retains declarations and typed emission for internal event-bus listeners', async () => {
    const emit = jest.fn().mockResolvedValue(undefined)
    setGlobalEventBus({ emit })

    for (const event of eventsConfig.events) {
      expect(isEventDeclared(event.id)).toBe(true)
    }
    const registeredIds = getDeclaredEvents()
      .filter((event) => event.module === 'documents')
      .map((event) => event.id)
    expect(registeredIds).toEqual(eventsConfig.events.map((event) => event.id))

    const payload = {
      id: 'document-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      title: 'Private plan',
    }
    await emitDocumentsEvent('documents.document.updated', payload)

    expect(emit).toHaveBeenCalledWith('documents.document.updated', payload, undefined)
  })
})
