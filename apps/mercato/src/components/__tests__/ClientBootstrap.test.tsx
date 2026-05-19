/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'

const registerInjectionWidgets = jest.fn()
const registerCoreInjectionWidgets = jest.fn()
const registerCoreInjectionTables = jest.fn()
const registerEnabledModuleIds = jest.fn()
const registerDashboardWidgets = jest.fn()
const registerNotificationHandlers = jest.fn()

const messagesClientSideEffect = jest.fn()
const paymentsClientSideEffect = jest.fn()
const translationsFieldsSideEffect = jest.fn()

jest.mock('@open-mercato/core/modules/widgets/lib/injection', () => ({
  registerCoreInjectionWidgets: (...args: unknown[]) => registerCoreInjectionWidgets(...args),
  registerCoreInjectionTables: (...args: unknown[]) => registerCoreInjectionTables(...args),
  registerEnabledModuleIds: (...args: unknown[]) => registerEnabledModuleIds(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/widgetRegistry', () => ({
  registerInjectionWidgets: (...args: unknown[]) => registerInjectionWidgets(...args),
}))

jest.mock('@open-mercato/ui/backend/dashboard/widgetRegistry', () => ({
  registerDashboardWidgets: (...args: unknown[]) => registerDashboardWidgets(...args),
}))

jest.mock('@open-mercato/shared/lib/notifications/handler-registry', () => ({
  registerNotificationHandlers: (...args: unknown[]) => registerNotificationHandlers(...args),
}))

jest.mock('@/.mercato/generated/injection-widgets.generated', () => ({
  injectionWidgetEntries: [{ key: 'widget-a' }],
}), { virtual: true })

jest.mock('@/.mercato/generated/injection-tables.generated', () => ({
  injectionTables: [{ moduleId: 'mod-a', table: {} }],
}), { virtual: true })

jest.mock('@/.mercato/generated/enabled-module-ids.generated', () => ({
  enabledModuleIds: ['mod-a', 'mod-b'],
}), { virtual: true })

jest.mock('@/.mercato/generated/dashboard-widgets.generated', () => ({
  dashboardWidgetEntries: [{ key: 'dashboard-widget-a' }],
}), { virtual: true })

jest.mock('@/.mercato/generated/notification-handlers.generated', () => ({
  notificationHandlerEntries: [{ moduleId: 'mod-a', handlers: [] }],
}), { virtual: true })

jest.mock('@/.mercato/generated/translations-fields.generated', () => {
  translationsFieldsSideEffect()
  return {}
}, { virtual: true })

jest.mock('@/.mercato/generated/messages.client.generated', () => {
  messagesClientSideEffect()
  return {}
}, { virtual: true })

jest.mock('@/.mercato/generated/payments.client.generated', () => {
  paymentsClientSideEffect()
  return {}
}, { virtual: true })

describe('clientBootstrap (async)', () => {
  let __clientBootstrapForTests: () => Promise<void>
  let __resetClientBootstrapForTests: () => void

  beforeEach(() => {
    jest.resetModules()
    registerInjectionWidgets.mockReset()
    registerCoreInjectionWidgets.mockReset()
    registerCoreInjectionTables.mockReset()
    registerEnabledModuleIds.mockReset()
    registerDashboardWidgets.mockReset()
    registerNotificationHandlers.mockReset()
    messagesClientSideEffect.mockReset()
    paymentsClientSideEffect.mockReset()
    translationsFieldsSideEffect.mockReset()

    const mod = require('../ClientBootstrap')
    __clientBootstrapForTests = mod.__clientBootstrapForTests
    __resetClientBootstrapForTests = mod.__resetClientBootstrapForTests
    __resetClientBootstrapForTests()
  })

  it('registers all generated entries after the dynamic imports resolve', async () => {
    await __clientBootstrapForTests()

    expect(registerInjectionWidgets).toHaveBeenCalledWith([{ key: 'widget-a' }])
    expect(registerCoreInjectionWidgets).toHaveBeenCalledWith([{ key: 'widget-a' }])
    expect(registerCoreInjectionTables).toHaveBeenCalledWith([{ moduleId: 'mod-a', table: {} }])
    expect(registerEnabledModuleIds).toHaveBeenCalledWith(['mod-a', 'mod-b'])
    expect(registerDashboardWidgets).toHaveBeenCalledWith([{ key: 'dashboard-widget-a' }])
    expect(registerNotificationHandlers).toHaveBeenCalledWith([{ moduleId: 'mod-a', handlers: [] }])

    expect(translationsFieldsSideEffect).toHaveBeenCalledTimes(1)
    expect(messagesClientSideEffect).toHaveBeenCalledTimes(1)
    expect(paymentsClientSideEffect).toHaveBeenCalledTimes(1)
  })

  it('does not register twice when called repeatedly', async () => {
    await __clientBootstrapForTests()
    await __clientBootstrapForTests()
    await __clientBootstrapForTests()

    expect(registerInjectionWidgets).toHaveBeenCalledTimes(1)
    expect(registerCoreInjectionWidgets).toHaveBeenCalledTimes(1)
    expect(registerCoreInjectionTables).toHaveBeenCalledTimes(1)
    expect(registerEnabledModuleIds).toHaveBeenCalledTimes(1)
    expect(registerDashboardWidgets).toHaveBeenCalledTimes(1)
    expect(registerNotificationHandlers).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight promise across concurrent callers', async () => {
    const first = __clientBootstrapForTests()
    const second = __clientBootstrapForTests()

    await Promise.all([first, second])

    expect(registerInjectionWidgets).toHaveBeenCalledTimes(1)
    expect(registerDashboardWidgets).toHaveBeenCalledTimes(1)
    expect(registerNotificationHandlers).toHaveBeenCalledTimes(1)
  })

  it('re-runs registration after reset', async () => {
    await __clientBootstrapForTests()
    expect(registerInjectionWidgets).toHaveBeenCalledTimes(1)

    __resetClientBootstrapForTests()
    await __clientBootstrapForTests()

    expect(registerInjectionWidgets).toHaveBeenCalledTimes(2)
    expect(registerDashboardWidgets).toHaveBeenCalledTimes(2)
    expect(registerNotificationHandlers).toHaveBeenCalledTimes(2)
  })
})
