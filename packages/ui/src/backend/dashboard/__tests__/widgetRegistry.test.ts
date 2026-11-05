/**
 * @jest-environment jsdom
 */

import type { ModuleDashboardWidgetEntry } from '@open-mercato/shared/modules/registry'

function createEntry(loader = jest.fn().mockResolvedValue({ Widget: () => null })): ModuleDashboardWidgetEntry {
  return {
    moduleId: 'example',
    key: 'example.dashboard.widget',
    source: 'app',
    loader,
  }
}

describe('dashboard widget registry', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('waits for client bootstrap registration before resolving widget modules', async () => {
    const { loadDashboardWidgetModule, registerDashboardWidgets } = await import('../widgetRegistry')
    const loader = jest.fn().mockResolvedValue({ Widget: () => null })
    const pending = loadDashboardWidgetModule('example.dashboard.widget')
    let resolved = false
    pending.then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)
    expect(loader).not.toHaveBeenCalled()

    registerDashboardWidgets([createEntry(loader)])

    await expect(pending).resolves.toEqual({ Widget: expect.any(Function) })
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('uses the latest entries after dashboard widgets are re-registered', async () => {
    const { loadDashboardWidgetModule, registerDashboardWidgets } = await import('../widgetRegistry')
    const firstLoader = jest.fn().mockResolvedValue({ Widget: () => null })
    const secondLoader = jest.fn().mockResolvedValue({ Widget: () => null })

    registerDashboardWidgets([createEntry(firstLoader)])
    await loadDashboardWidgetModule('example.dashboard.widget')

    registerDashboardWidgets([
      {
        ...createEntry(secondLoader),
        key: 'example.dashboard.other',
      },
    ])

    await loadDashboardWidgetModule('example.dashboard.other')

    expect(firstLoader).toHaveBeenCalledTimes(1)
    expect(secondLoader).toHaveBeenCalledTimes(1)
  })
})
