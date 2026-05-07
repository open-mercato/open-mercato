/**
 * Coverage for the unified `modules.ts` override dispatcher. The
 * dispatcher walks `enabledModules`, buckets every entry's
 * `overrides.<domain>` shape by domain, and forwards each domain's
 * bucket to the registered per-domain applier. Unwired domains emit a
 * one-shot structured warning so an early adopter notices instead of
 * silently no-opping.
 *
 * Spec: `.ai/specs/2026-05-04-modules-ts-unified-overrides.md`.
 */
import {
  applyModuleOverridesFromEnabledModules,
  registerModuleOverrideApplier,
  resetModuleOverrideAppliersForTests,
  type ModuleEntryWithOverrides,
  type ModuleOverrideEntry,
} from '../overrides'

beforeEach(() => {
  resetModuleOverrideAppliersForTests()
})

describe('applyModuleOverridesFromEnabledModules', () => {
  it('forwards an entry.overrides.<domain> sub-tree to the registered applier', () => {
    const received: Array<ModuleOverrideEntry<{ agents?: Record<string, unknown> }>> = []
    registerModuleOverrideApplier<{ agents?: Record<string, unknown> }>('ai', (entries) => {
      received.push(...entries)
    })

    const modules: ModuleEntryWithOverrides[] = [
      {
        id: 'example',
        from: '@app',
        overrides: {
          ai: { agents: { 'catalog.catalog_assistant': null } },
        },
      },
    ]

    applyModuleOverridesFromEnabledModules(modules)

    expect(received).toHaveLength(1)
    expect(received[0].moduleId).toBe('example')
    expect(received[0].overrides).toEqual({
      agents: { 'catalog.catalog_assistant': null },
    })
  })

  it('preserves module load order across multiple entries', () => {
    const received: string[] = []
    registerModuleOverrideApplier<unknown>('ai', (entries) => {
      for (const entry of entries) received.push(entry.moduleId)
    })

    applyModuleOverridesFromEnabledModules([
      { id: 'first', overrides: { ai: { agents: { 'm.x': null } } } },
      { id: 'second', overrides: { ai: { agents: { 'm.x': null } } } },
    ])

    expect(received).toEqual(['first', 'second'])
  })

  it('skips entries without `overrides`', () => {
    const applier = jest.fn()
    registerModuleOverrideApplier('ai', applier)

    applyModuleOverridesFromEnabledModules([
      { id: 'plain', from: '@app' },
      { id: 'noai', from: '@app', overrides: {} },
    ])

    expect(applier).not.toHaveBeenCalled()
  })

  it('emits a one-shot structured warning per unwired domain', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    applyModuleOverridesFromEnabledModules([
      {
        id: 'a',
        overrides: { routes: { api: { 'GET /api/x': null } } },
      },
      {
        id: 'b',
        overrides: { routes: { api: { 'POST /api/y': null } } },
      },
    ])

    // Same domain hit twice — only one warning per process.
    const routesCalls = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('Domain "routes"'),
    )
    expect(routesCalls).toHaveLength(1)
    expect(routesCalls[0][0]).toContain('not yet wired')
    expect(routesCalls[0][0]).toContain('module(s) [a, b]')
    expect(routesCalls[0][0]).toContain('issues/1787')

    // Different unwired domain — separate one-shot warning.
    applyModuleOverridesFromEnabledModules([
      { id: 'c', overrides: { events: { subscribers: { 'x': null } } } },
    ])
    const eventsCalls = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('Domain "events"'),
    )
    expect(eventsCalls).toHaveLength(1)

    warnSpy.mockRestore()
  })

  it('does NOT consume the legacy `aiAgentOverrides` / `aiToolOverrides` keys', () => {
    const applier = jest.fn()
    registerModuleOverrideApplier('ai', applier)

    applyModuleOverridesFromEnabledModules([
      // The umbrella dispatcher only reads `overrides.ai`.
      // Legacy top-level keys are intentionally ignored — the key rename
      // is hard because the AI shape never shipped on `develop`.
      {
        id: 'legacy',
        // @ts-expect-error legacy shape kept here just to assert it is not picked up
        aiAgentOverrides: { 'catalog.catalog_assistant': null },
      },
    ])

    expect(applier).not.toHaveBeenCalled()
  })

  it('routes only the domains that are present on the entry', () => {
    const aiApplier = jest.fn()
    const widgetsApplier = jest.fn()
    registerModuleOverrideApplier('ai', aiApplier)
    registerModuleOverrideApplier('widgets', widgetsApplier)

    applyModuleOverridesFromEnabledModules([
      { id: 'a', overrides: { ai: { agents: { 'm.x': null } } } },
    ])

    expect(aiApplier).toHaveBeenCalledTimes(1)
    expect(widgetsApplier).not.toHaveBeenCalled()
  })
})
