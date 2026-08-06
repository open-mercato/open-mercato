/**
 * @jest-environment node
 */
import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'

describe('dashboard widget discovery', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
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
})
