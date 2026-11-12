import { createModuleEvents, isCoalescedBroadcastEvent } from '../factory'

const GLOBAL_EVENT_REGISTRY_KEY = '__openMercatoEventDefinitionRegistry__'

describe('broadcastCoalescing declarations', () => {
  const globalScope = globalThis as Record<string, unknown>
  const originalRegistry = globalScope[GLOBAL_EVENT_REGISTRY_KEY]

  beforeEach(() => {
    delete globalScope[GLOBAL_EVENT_REGISTRY_KEY]
  })

  afterAll(() => {
    if (originalRegistry === undefined) delete globalScope[GLOBAL_EVENT_REGISTRY_KEY]
    else globalScope[GLOBAL_EVENT_REGISTRY_KEY] = originalRegistry
  })

  it('recognizes an opted-in browser event and nothing else', () => {
    createModuleEvents({
      moduleId: 'coalesce_decl_test',
      events: [
        { id: 'coalesce_decl_test.bulk', label: 'Bulk', clientBroadcast: true, broadcastCoalescing: true },
        { id: 'coalesce_decl_test.portal', label: 'Portal', portalBroadcast: true, broadcastCoalescing: true },
        { id: 'coalesce_decl_test.plain_browser', label: 'Plain Browser', clientBroadcast: true },
        { id: 'coalesce_decl_test.local', label: 'Local' },
      ] as const,
    })

    expect(isCoalescedBroadcastEvent('coalesce_decl_test.bulk')).toBe(true)
    expect(isCoalescedBroadcastEvent('coalesce_decl_test.portal')).toBe(true)
    expect(isCoalescedBroadcastEvent('coalesce_decl_test.plain_browser')).toBe(false)
    expect(isCoalescedBroadcastEvent('coalesce_decl_test.local')).toBe(false)
    expect(isCoalescedBroadcastEvent('coalesce_decl_test.never_declared')).toBe(false)
  })

  it('rejects coalescing private cross-process coordination', () => {
    expect(() => createModuleEvents({
      moduleId: 'coalesce_decl_test',
      events: [
        { id: 'coalesce_decl_test.private', label: 'Private', crossProcessBroadcast: true, broadcastCoalescing: true },
      ] as const,
    })).toThrow(/crossProcessBroadcast/)
  })

  it('rejects coalescing an event with no browser delivery to coalesce', () => {
    expect(() => createModuleEvents({
      moduleId: 'coalesce_decl_test',
      events: [
        { id: 'coalesce_decl_test.orphan', label: 'Orphan', broadcastCoalescing: true },
      ] as const,
    })).toThrow(/clientBroadcast or portalBroadcast/)
  })
})
