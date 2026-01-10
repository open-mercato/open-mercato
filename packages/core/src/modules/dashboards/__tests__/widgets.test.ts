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
