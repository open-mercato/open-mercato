import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { DefaultDataEngine, __resetUndeclaredEventWarningsForTests } from '../engine'
import { createModuleEvents, registerEventModuleConfigs } from '../../../modules/events'

const testEvents = [
  { id: 'issue1421_test.widget.created', label: 'Widget Created', entity: 'widget', category: 'crud' as const },
  { id: 'issue1421_test.widget.updated', label: 'Widget Updated', entity: 'widget', category: 'crud' as const },
  { id: 'issue1421_test.widget.deleted', label: 'Widget Deleted', entity: 'widget', category: 'crud' as const },
] as const

// Register the declared events with the shared registry used by DataEngine.
createModuleEvents({ moduleId: 'issue1421_test', events: testEvents })

type EmittedEvent = { name: string; payload: unknown; options?: unknown }

function makeFixture() {
  const emitted: EmittedEvent[] = []
  const bus = {
    emitEvent: jest.fn(async (name: string, payload: unknown, options?: unknown) => {
      emitted.push({ name, payload, options })
    }),
  }
  const container = {
    resolve: (name: string) => (name === 'eventBus' ? bus : undefined),
  } as unknown as AwilixContainer
  const em = {} as unknown as EntityManager
  const engine = new DefaultDataEngine(em, container)
  return { engine, bus, emitted }
}

describe('DataEngine event contract validation (issue #1421)', () => {
  const identifiers = {
    id: 'rec-1',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
  }

  beforeEach(() => {
    __resetUndeclaredEventWarningsForTests()
  })

  it('emits declared events without warning', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { engine, emitted } = makeFixture()

      await engine.emitOrmEntityEvent({
        action: 'created',
        entity: { id: identifiers.id },
        identifiers,
        events: { module: 'issue1421_test', entity: 'widget' },
      })

      expect(emitted).toEqual([
        expect.objectContaining({ name: 'issue1421_test.widget.created' }),
      ])
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('accepts events declared through bootstrap-registered module configs', async () => {
    registerEventModuleConfigs([
      {
        moduleId: 'issue1421_bootstrap',
        events: [
          {
            id: 'issue1421_bootstrap.widget.deleted',
            label: 'Widget Deleted',
            module: 'issue1421_bootstrap',
            entity: 'widget',
            category: 'crud',
          },
        ],
        emit: jest.fn(),
      },
    ])

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { engine, emitted } = makeFixture()

      await engine.emitOrmEntityEvent({
        action: 'deleted',
        entity: { id: identifiers.id },
        identifiers,
        events: { module: 'issue1421_bootstrap', entity: 'widget' },
      })

      expect(emitted).toEqual([
        expect.objectContaining({ name: 'issue1421_bootstrap.widget.deleted' }),
      ])
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('warns when emitting an event that is not registered', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { engine, emitted } = makeFixture()

      await engine.emitOrmEntityEvent({
        action: 'created',
        entity: { id: identifiers.id },
        identifiers,
        events: { module: 'issue1421_unregistered', entity: 'ghost' },
      })

      expect(warnSpy).toHaveBeenCalledTimes(1)
      const warningMessage = warnSpy.mock.calls[0]?.[0] ?? ''
      expect(warningMessage).toContain('issue1421_unregistered.ghost.created')
      expect(warningMessage).toContain('events.ts')

      // Emission is still attempted (non-strict), matching the factory's default behavior
      expect(emitted).toEqual([
        expect.objectContaining({ name: 'issue1421_unregistered.ghost.created' }),
      ])
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('deduplicates repeated warnings for the same undeclared event', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { engine } = makeFixture()

      for (let i = 0; i < 3; i++) {
        await engine.emitOrmEntityEvent({
          action: 'updated',
          entity: { id: identifiers.id },
          identifiers,
          events: { module: 'issue1421_unregistered', entity: 'ghost' },
        })
      }

      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('passes actorUserId through queued CRUD event payload builders', async () => {
    const { engine, emitted } = makeFixture()

    engine.markOrmEntityChange({
      action: 'created',
      entity: { id: identifiers.id },
      identifiers,
      actorUserId: 'user-123',
      events: {
        module: 'issue1421_test',
        entity: 'widget',
        buildPayload: (ctx) => ({
          id: ctx.identifiers.id,
          userId: ctx.actorUserId,
        }),
      },
    })

    await engine.flushOrmEntityChanges()

    expect(emitted).toEqual([
      expect.objectContaining({
        name: 'issue1421_test.widget.created',
        payload: { id: identifiers.id, userId: 'user-123' },
      }),
    ])
  })
})
