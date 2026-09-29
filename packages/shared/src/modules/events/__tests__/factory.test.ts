/**
 * Events factory — payloadSchema declaration and the generated CRUD default.
 *
 * Verifies the additive `payloadSchema` contract on `EventDefinition`:
 * platform CRUD after-events (`*.created`/`*.updated`/`*.deleted`, category
 * `crud`) receive the generated `{ id, organizationId, tenantId, syncOrigin }`
 * default; explicit declarations are preserved untouched; lifecycle/system
 * events and CRUD "before" events get no default; and `getDeclaredEvents()`
 * exposes the same definitions the module config carries.
 */

import {
  createModuleEvents,
  getDeclaredEvents,
  DEFAULT_CRUD_PAYLOAD_SCHEMA,
} from '../factory'
import type { EventPayloadSchema } from '../types'

const explicitSchema: EventPayloadSchema = {
  fields: [
    { path: 'id', type: 'text' },
    { path: 'amount', type: 'number', optional: true },
    { path: 'meta', type: 'object' },
  ],
}

const config = createModuleEvents({
  moduleId: 'factory_test',
  events: [
    { id: 'factory_test.widget.created', label: 'Widget Created', entity: 'widget', category: 'crud' },
    { id: 'factory_test.widget.updated', label: 'Widget Updated', entity: 'widget', category: 'crud' },
    { id: 'factory_test.widget.deleted', label: 'Widget Deleted', entity: 'widget', category: 'crud' },
    { id: 'factory_test.widget.creating', label: 'Widget Creating', entity: 'widget', category: 'crud', excludeFromTriggers: true },
    { id: 'factory_test.widget.archived', label: 'Widget Archived', entity: 'widget', category: 'lifecycle' },
    { id: 'factory_test.widget.scored', label: 'Widget Scored', entity: 'widget', category: 'lifecycle', payloadSchema: explicitSchema },
    { id: 'factory_test.widget.replaced', label: 'Widget Replaced', entity: 'widget', category: 'crud', payloadSchema: explicitSchema },
  ] as const,
})

function findEvent(id: string) {
  const event = config.events.find(e => e.id === id)
  if (!event) throw new Error(`[internal] event ${id} missing from config`)
  return event
}

describe('createModuleEvents payloadSchema', () => {
  it('attaches the generated CRUD default to platform CRUD after-events', () => {
    for (const suffix of ['created', 'updated', 'deleted']) {
      expect(findEvent(`factory_test.widget.${suffix}`).payloadSchema).toEqual(DEFAULT_CRUD_PAYLOAD_SCHEMA)
    }
  })

  it('generated default mirrors the engine emit payload fields', () => {
    expect(DEFAULT_CRUD_PAYLOAD_SCHEMA.fields.map(f => f.path)).toEqual([
      'id',
      'organizationId',
      'tenantId',
      'syncOrigin',
    ])
    const idField = DEFAULT_CRUD_PAYLOAD_SCHEMA.fields.find(f => f.path === 'id')
    expect(idField).toEqual({ path: 'id', type: 'text' })
    expect(DEFAULT_CRUD_PAYLOAD_SCHEMA.fields.filter(f => f.optional).map(f => f.path)).toEqual([
      'organizationId',
      'tenantId',
      'syncOrigin',
    ])
  })

  it('does not default CRUD "before" lifecycle suffixes or non-crud categories', () => {
    expect(findEvent('factory_test.widget.creating').payloadSchema).toBeUndefined()
    expect(findEvent('factory_test.widget.archived').payloadSchema).toBeUndefined()
  })

  it('preserves an explicit payloadSchema over the generated default', () => {
    expect(findEvent('factory_test.widget.replaced').payloadSchema).toBe(explicitSchema)
    expect(findEvent('factory_test.widget.scored').payloadSchema).toBe(explicitSchema)
  })

  it('exposes the same definitions through getDeclaredEvents()', () => {
    const declared = getDeclaredEvents().filter(e => e.module === 'factory_test')
    expect(declared).toHaveLength(config.events.length)
    const declaredCreated = declared.find(e => e.id === 'factory_test.widget.created')
    expect(declaredCreated?.payloadSchema).toEqual(DEFAULT_CRUD_PAYLOAD_SCHEMA)
    const declaredScored = declared.find(e => e.id === 'factory_test.widget.scored')
    expect(declaredScored?.payloadSchema).toBe(explicitSchema)
  })

  it('keeps unrelated declaration fields intact when defaulting', () => {
    const creating = findEvent('factory_test.widget.creating')
    expect(creating.excludeFromTriggers).toBe(true)
    const created = findEvent('factory_test.widget.created')
    expect(created.module).toBe('factory_test')
    expect(created.entity).toBe('widget')
  })
})

const GLOBAL_EVENT_REGISTRY_KEY = '__openMercatoEventDefinitionRegistry__'

type EventFactoryModule = typeof import('../factory')

describe('event definition registry', () => {
  const globalScope = globalThis as Record<string, unknown>
  const originalRegistry = globalScope[GLOBAL_EVENT_REGISTRY_KEY]

  beforeEach(() => {
    delete globalScope[GLOBAL_EVENT_REGISTRY_KEY]
  })

  afterAll(() => {
    if (originalRegistry === undefined) {
      delete globalScope[GLOBAL_EVENT_REGISTRY_KEY]
    } else {
      globalScope[GLOBAL_EVENT_REGISTRY_KEY] = originalRegistry
    }
  })

  it('shares declarations and registered configs across isolated module instances', () => {
    let firstInstance: EventFactoryModule | undefined
    let secondInstance: EventFactoryModule | undefined

    jest.isolateModules(() => {
      firstInstance = require('../factory') as EventFactoryModule
      const config = firstInstance.createModuleEvents({
        moduleId: 'isolated_events_test',
        events: [{
          id: 'isolated_events_test.invalidated',
          label: 'Invalidated',
          crossProcessBroadcast: true,
        }] as const,
      })
      firstInstance.registerEventModuleConfigs([config])
    })

    jest.isolateModules(() => {
      secondInstance = require('../factory') as EventFactoryModule
    })

    expect(secondInstance).not.toBe(firstInstance)
    expect(secondInstance?.isEventDeclared('isolated_events_test.invalidated')).toBe(true)
    expect(secondInstance?.isCrossProcessBroadcastEvent('isolated_events_test.invalidated')).toBe(true)
    expect(secondInstance?.getDeclaredEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'isolated_events_test.invalidated',
        module: 'isolated_events_test',
      }),
    ]))
    expect(secondInstance?.getEventModuleConfigs()).toHaveLength(1)
  })

  it('refreshes a module definition during HMR without duplicating its event id', () => {
    let firstInstance: EventFactoryModule | undefined
    let secondInstance: EventFactoryModule | undefined

    jest.isolateModules(() => {
      firstInstance = require('../factory') as EventFactoryModule
      firstInstance.createModuleEvents({
        moduleId: 'hmr_events_test',
        events: [{ id: 'hmr_events_test.changed', label: 'Before' }] as const,
      })
    })

    jest.isolateModules(() => {
      secondInstance = require('../factory') as EventFactoryModule
      secondInstance.createModuleEvents({
        moduleId: 'hmr_events_test',
        events: [{
          id: 'hmr_events_test.changed',
          label: 'After',
          clientBroadcast: true,
        }] as const,
      })
    })

    expect(firstInstance?.isBroadcastEvent('hmr_events_test.changed')).toBe(true)
    expect(firstInstance?.getAllDeclaredEventIds()).toEqual(['hmr_events_test.changed'])
    expect(firstInstance?.getDeclaredEvents()).toEqual([
      expect.objectContaining({
        id: 'hmr_events_test.changed',
        label: 'After',
        clientBroadcast: true,
      }),
    ])
  })
})
