/**
 * @jest-environment node
 */
import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'

// The module registry and its listener set live on `globalThis`, so they survive
// `jest.resetModules()`. Clearing both keeps each case hermetic: a leftover module
// list would be merged into an i18n-only registration, and listeners left behind by
// a previous test's (now dead) widgets module instance would accumulate.
function clearModuleRegistryGlobals(): void {
  delete (globalThis as any).__openMercatoModulesRegistry__
  delete (globalThis as any).__openMercatoModulesRegistryListeners__
}

describe('dashboard widget discovery', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    clearModuleRegistryGlobals()
  })

  afterAll(() => {
    clearModuleRegistryGlobals()
  })

  it('loads widgets once and deduplicates by metadata id', async () => {
    const loaderA = jest.fn(async () => ({
      default: {
        metadata: { id: 'example.dashboard.notes', title: 'Notes' },
        Widget: () => null,
      } satisfies DashboardWidgetModule<any>,
    }))
    const loaderB = jest.fn(async () => ({
      default: {
        metadata: { id: 'example.dashboard.notes', title: 'Notes override' },
        Widget: () => null,
      } satisfies DashboardWidgetModule<any>,
    }))
    // Must import registerModules fresh after jest.resetModules()
    const { registerModules } = await import('@open-mercato/shared/lib/i18n/server')
    registerModules([
      { id: 'example', dashboardWidgets: [{ key: 'example:notes:widget', moduleId: 'example', loader: loaderA }] },
      { id: 'custom', dashboardWidgets: [{ key: 'custom:notes:widget', moduleId: 'custom', loader: loaderB }] },
    ] as any)

    const { loadAllWidgets, loadWidgetById, invalidateWidgetCache } = await import('../lib/widgets')
    invalidateWidgetCache()
    const all = await loadAllWidgets()

    expect(all).toHaveLength(1)
    expect(all[0].metadata.id).toBe('example.dashboard.notes')
    expect(loaderA).toHaveBeenCalledTimes(1)
    expect(loaderB).toHaveBeenCalledTimes(1)

    // Second load should use cache and not re-invoke loaders
    const again = await loadAllWidgets()
    expect(again).toHaveLength(1)
    expect(loaderA).toHaveBeenCalledTimes(1)
    expect(loaderB).toHaveBeenCalledTimes(1)

    const fetched = await loadWidgetById('example.dashboard.notes')
    expect(fetched?.metadata.title).toBe('Notes')
  })

  it('honors overrides.widgets.dashboard on the server-side catalog (#4377)', async () => {
    const keptLoader = jest.fn(async () => ({
      default: {
        metadata: { id: 'example.dashboard.kept', title: 'Kept' },
        Widget: () => null,
      } satisfies DashboardWidgetModule<any>,
    }))
    const removedLoader = jest.fn(async () => ({
      default: {
        metadata: { id: 'example.dashboard.removed', title: 'Removed' },
        Widget: () => null,
      } satisfies DashboardWidgetModule<any>,
    }))

    const { registerModules } = await import('@open-mercato/shared/lib/i18n/server')
    registerModules([
      {
        id: 'example',
        dashboardWidgets: [
          { key: 'example:kept:widget', moduleId: 'example', loader: keptLoader },
          { key: 'example:removed:widget', moduleId: 'example', loader: removedLoader },
        ],
      },
    ] as any)

    const { applyDashboardWidgetOverrides } = await import('@open-mercato/shared/modules/overrides')
    applyDashboardWidgetOverrides({ 'example:removed:widget': null })

    const { loadAllWidgets, loadWidgetById, invalidateWidgetCache } = await import('../lib/widgets')
    invalidateWidgetCache()

    const all = await loadAllWidgets()
    expect(all.map((widget) => widget.metadata.id)).toEqual(['example.dashboard.kept'])
    expect(removedLoader).not.toHaveBeenCalled()

    await expect(loadWidgetById('example.dashboard.removed')).resolves.toBeNull()
  })

  it('retries an empty registry instead of caching it for the process lifetime (#5041)', async () => {
    const loader = jest.fn(async () => ({
      default: {
        metadata: { id: 'example.dashboard.late', title: 'Late' },
        Widget: () => null,
      } satisfies DashboardWidgetModule<any>,
    }))

    const { registerModules } = await import('@open-mercato/shared/lib/i18n/server')
    registerModules([] as any)

    const { loadAllWidgets, invalidateWidgetCache } = await import('../lib/widgets')
    invalidateWidgetCache()

    await expect(loadAllWidgets()).resolves.toEqual([])

    // The registry finishes populating after the first (boot-race) read.
    registerModules([
      { id: 'example', dashboardWidgets: [{ key: 'example:late:widget', moduleId: 'example', loader }] },
    ] as any)

    const recovered = await loadAllWidgets()
    expect(recovered.map((widget) => widget.metadata.id)).toEqual(['example.dashboard.late'])
  })

  it('retries after a failed registry resolution (#5041)', async () => {
    const loader = jest.fn(async () => ({
      default: {
        metadata: { id: 'example.dashboard.recovered', title: 'Recovered' },
        Widget: () => null,
      } satisfies DashboardWidgetModule<any>,
    }))
    const entries = [{ key: 'example:recovered:widget', moduleId: 'example', loader }]
    let reads = 0

    const { registerModules } = await import('@open-mercato/shared/lib/i18n/server')
    registerModules([
      {
        id: 'example',
        get dashboardWidgets() {
          reads += 1
          if (reads === 1) throw new Error('registry not ready')
          return entries
        },
      },
    ] as any)

    const { loadAllWidgets, invalidateWidgetCache } = await import('../lib/widgets')
    invalidateWidgetCache()

    await expect(loadAllWidgets()).rejects.toThrow('registry not ready')

    const recovered = await loadAllWidgets()
    expect(recovered.map((widget) => widget.metadata.id)).toEqual(['example.dashboard.recovered'])
  })

  it('retries a widget loader that rejected instead of caching the failure (#5041)', async () => {
    let attempts = 0
    const loader = jest.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('transient import failure')
      return {
        default: {
          metadata: { id: 'example.dashboard.flaky', title: 'Flaky' },
          Widget: () => null,
        } satisfies DashboardWidgetModule<any>,
      }
    })

    const { registerModules } = await import('@open-mercato/shared/lib/i18n/server')
    registerModules([
      { id: 'example', dashboardWidgets: [{ key: 'example:flaky:widget', moduleId: 'example', loader }] },
    ] as any)

    const { loadAllWidgets, invalidateWidgetCache } = await import('../lib/widgets')
    invalidateWidgetCache()

    await expect(loadAllWidgets()).rejects.toThrow('transient import failure')

    const recovered = await loadAllWidgets()
    expect(recovered.map((widget) => widget.metadata.id)).toEqual(['example.dashboard.flaky'])
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('returns null for unknown widget id', async () => {
    const { registerModules } = await import('@open-mercato/shared/lib/i18n/server')
    registerModules([] as any)
    const { loadWidgetById, invalidateWidgetCache } = await import('../lib/widgets')
    invalidateWidgetCache()
    await expect(loadWidgetById('missing.widget')).resolves.toBeNull()
  })

  it('throws when widget metadata is invalid', async () => {
    const badLoader = jest.fn(async () => ({ default: { Widget: () => null } }))
    const { registerModules } = await import('@open-mercato/shared/lib/i18n/server')
    registerModules([
      { id: 'broken', dashboardWidgets: [{ key: 'broken:widget', moduleId: 'broken', loader: badLoader }] },
    ] as any)

    const { loadAllWidgets, invalidateWidgetCache } = await import('../lib/widgets')
    invalidateWidgetCache()
    await expect(loadAllWidgets()).rejects.toThrow('missing metadata')
  })

  describe('module-registry reload invalidation (#5103)', () => {
    const notesLoader = () => jest.fn(async () => ({
      default: {
        metadata: { id: 'example.dashboard.notes', title: 'Notes' },
        Widget: () => null,
      } satisfies DashboardWidgetModule<any>,
    }))
    const kpiLoader = () => jest.fn(async () => ({
      default: {
        metadata: { id: 'reports.dashboard.kpi', title: 'KPI' },
        Widget: () => null,
      } satisfies DashboardWidgetModule<any>,
    }))

    it('sees widgets after an i18n-only bootstrap is reconciled with the full module list', async () => {
      const loader = notesLoader()
      const { registerModules } = await import('@open-mercato/shared/lib/i18n/server')
      registerModules([{ id: 'example', translations: { en: { 'example.hello': 'Hello' } } }] as any)

      const { loadAllWidgets } = await import('../lib/widgets')
      await expect(loadAllWidgets()).resolves.toEqual([])

      registerModules([
        { id: 'example', dashboardWidgets: [{ key: 'example:notes:widget', moduleId: 'example', loader }] },
      ] as any)

      const afterReload = await loadAllWidgets()
      expect(afterReload.map((widget) => widget.metadata.id)).toEqual(['example.dashboard.notes'])
    })

    it('drops a resolution built from a partial module list when the rest of the modules register', async () => {
      const notes = notesLoader()
      const kpi = kpiLoader()
      const { registerModules } = await import('@open-mercato/shared/lib/i18n/server')
      registerModules([
        { id: 'example', dashboardWidgets: [{ key: 'example:notes:widget', moduleId: 'example', loader: notes }] },
      ] as any)

      const { loadAllWidgets } = await import('../lib/widgets')
      const beforeReload = await loadAllWidgets()
      expect(beforeReload.map((widget) => widget.metadata.id)).toEqual(['example.dashboard.notes'])

      registerModules([
        { id: 'example', dashboardWidgets: [{ key: 'example:notes:widget', moduleId: 'example', loader: notes }] },
        { id: 'reports', dashboardWidgets: [{ key: 'reports:kpi:widget', moduleId: 'reports', loader: kpi }] },
      ] as any)

      const afterReload = await loadAllWidgets()
      expect(afterReload.map((widget) => widget.metadata.id).sort()).toEqual([
        'example.dashboard.notes',
        'reports.dashboard.kpi',
      ])
    })

    it('keeps the warm cache when the identical module list is re-registered', async () => {
      const notes = notesLoader()
      const modules = [
        { id: 'example', dashboardWidgets: [{ key: 'example:notes:widget', moduleId: 'example', loader: notes }] },
      ]
      const { registerModules } = await import('@open-mercato/shared/lib/i18n/server')
      registerModules(modules as any)

      const { loadAllWidgets } = await import('../lib/widgets')
      await loadAllWidgets()
      expect(notes).toHaveBeenCalledTimes(1)

      registerModules(modules as any)
      await loadAllWidgets()

      expect(notes).toHaveBeenCalledTimes(1)
    })
  })
})
