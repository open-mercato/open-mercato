import {
  getDeclaredEvents,
  isBroadcastEvent,
  isCrossProcessBroadcastEvent,
  isEventDeclared,
  setGlobalEventBus,
} from '@open-mercato/shared/modules/events'
import eventsConfig, { emitDocumentsEvent } from '../events'

describe('Documents events privacy contract', () => {
  afterEach(() => {
    setGlobalEventBus({ emit: async () => undefined })
  })

  it('bridges private document invalidations between processes without browser broadcast', () => {
    expect(eventsConfig.moduleId).toBe('documents')
    expect(eventsConfig.events).not.toHaveLength(0)

    for (const event of eventsConfig.events) {
      expect(event.id).toMatch(/^documents\./)
    }
    const crossProcessIds = eventsConfig.events
      .filter((event) => event.crossProcessBroadcast === true)
      .map((event) => event.id)

    expect(crossProcessIds).toEqual([
      'documents.document.updated',
      'documents.document.deleted',
      'documents.document.archived',
      'documents.document.unarchived',
      'documents.document.shared',
      'documents.document.unshared',
      'documents.version.restored',
    ])
    for (const event of eventsConfig.events) {
      expect(isBroadcastEvent(event.id)).toBe(false)
      expect(isCrossProcessBroadcastEvent(event.id)).toBe(crossProcessIds.includes(event.id))
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

    expect(emit).toHaveBeenCalledWith('documents.document.updated', payload, {
      emitterModuleId: 'documents',
    })
  })
})
