import {
  applyApiInterceptorOverridesToEntries,
  applyCommandInterceptorOverridesToEntries,
  applyComponentOverridesToEntries,
  applyDashboardWidgetOverridesToEntries,
  applyDiOverridesToContainer,
  applyInjectionWidgetOverridesToEntries,
  applyInjectionWidgetOverridesToTables,
  applyModuleOverridesFromEnabledModules,
  applyModuleOverridesToModules,
  applyNotificationHandlerOverridesToEntries,
  applyNotificationTypeOverridesToEntries,
  applyPageGuardOverridesToEntries,
  applyResponseEnricherOverridesToEntries,
  resetModuleContractOverridesForTests,
  resetModuleOverrideAppliersForTests,
  type ModuleEntryWithOverrides,
} from '../overrides'
import type { Module } from '../registry'

function makeEnabledModule(overrides: ModuleEntryWithOverrides['overrides']): ModuleEntryWithOverrides {
  return { id: 'example', from: '@app', overrides }
}

beforeEach(() => {
  resetModuleOverrideAppliersForTests()
  resetModuleContractOverridesForTests()
})

describe('module contract override helpers', () => {
  it('applies module-list overrides for subscribers, workers, CLI, setup, ACL and encryption maps', () => {
    const replacementSubscriber = {
      id: 'example.todo.audit',
      event: 'example.todo.updated',
      handler: jest.fn(),
    }
    const replacementWorker = {
      id: 'example:sync',
      queue: 'example-sync-v2',
      concurrency: 4,
      handler: jest.fn(),
    }
    const replacementCli = {
      command: 'example seed',
      run: jest.fn(),
    }

    applyModuleOverridesFromEnabledModules([
      makeEnabledModule({
        events: { subscribers: { 'example.todo.audit': replacementSubscriber } },
        workers: { 'example:sync': replacementWorker },
        cli: { 'example seed': replacementCli },
        setup: {
          defaultRoleFeatures: { admin: ['example.view'] },
          seedDefaults: false,
          seedExamples: false,
          onTenantCreated: false,
        },
        acl: {
          features: {
            'example.manage': null,
            'example.view': { id: 'example.view', title: 'View example', module: 'example' },
          },
        },
        encryption: {
          maps: {
            'example:item': null,
            'example:secret': { entityId: 'example:secret', fields: [{ field: 'token' }] },
          },
        },
      }),
    ])

    const module: Module = {
      id: 'example',
      subscribers: [
        { id: 'example.todo.audit', event: 'example.todo.created', handler: jest.fn() },
      ],
      workers: [
        { id: 'example:sync', queue: 'example-sync', concurrency: 1, handler: jest.fn() },
      ],
      cli: [
        { command: 'example seed', run: jest.fn() },
      ],
      setup: {
        onTenantCreated: jest.fn(),
        seedDefaults: jest.fn(),
        seedExamples: jest.fn(),
        defaultRoleFeatures: { admin: ['example.manage'] },
      },
      features: [
        { id: 'example.manage', title: 'Manage example', module: 'example' },
        { id: 'example.view', title: 'Old view example', module: 'example' },
      ],
      defaultEncryptionMaps: [
        { entityId: 'example:item', fields: [{ field: 'name' }] },
        { entityId: 'example:secret', fields: [{ field: 'oldToken' }] },
      ],
    }

    const [overridden] = applyModuleOverridesToModules([module])

    expect(overridden.subscribers).toEqual([replacementSubscriber])
    expect(overridden.workers).toEqual([replacementWorker])
    expect(overridden.cli).toEqual([replacementCli])
    expect(overridden.features).toEqual([
      { id: 'example.view', title: 'View example', module: 'example' },
    ])
    expect(overridden.defaultEncryptionMaps).toEqual([
      { entityId: 'example:secret', fields: [{ field: 'token' }] },
    ])
    expect(overridden.setup?.defaultRoleFeatures).toEqual({ admin: ['example.view'] })
    expect(overridden.setup?.seedDefaults).toBeUndefined()
    expect(overridden.setup?.seedExamples).toBeUndefined()
    expect(overridden.setup?.onTenantCreated).toBeUndefined()
  })

  it('applies registry-entry overrides for widgets, notifications, interceptors, enrichers and guards', () => {
    const injectionReplacement = {
      moduleId: 'override',
      key: 'example.toolbar',
      source: 'app' as const,
      loader: jest.fn(async () => ({ metadata: { id: 'example.toolbar' } })),
    }
    const dashboardReplacement = {
      moduleId: 'override',
      key: 'example.kpi',
      source: 'app' as const,
      loader: jest.fn(async () => ({ metadata: { id: 'example.kpi' } })),
    }
    const componentReplacement = {
      target: { componentId: 'page:/backend/example' },
      priority: 1,
      propsTransform: (props: unknown) => props,
    }
    const notificationTypeReplacement = {
      type: 'example.notice',
      module: 'example',
      titleKey: 'example.notifications.notice.title',
      icon: 'bell',
      severity: 'success' as const,
      actions: [],
    }
    const notificationHandlerReplacement = {
      id: 'example.notice.toast',
      notificationType: 'example.notice',
      handle: jest.fn(),
    }
    const apiInterceptorReplacement = {
      id: 'example.items.interceptor',
      targetRoute: '/api/example/items',
      methods: ['GET' as const],
      before: jest.fn(async () => ({ ok: true })),
    }
    const commandInterceptorReplacement = {
      id: 'example.command.interceptor',
      targetCommand: 'example.*',
      beforeExecute: jest.fn(async () => ({ ok: true })),
    }
    const enricherReplacement = {
      id: 'example.items.enricher',
      targetEntity: 'example.item',
      enrichOne: jest.fn(async (record: Record<string, unknown>) => ({ ...record, _example: true })),
    }
    const guardReplacement = {
      id: 'example.backend.guard',
      target: '/backend/example',
      run: jest.fn(() => ({ action: 'continue' as const })),
    }

    applyModuleOverridesFromEnabledModules([
      makeEnabledModule({
        widgets: {
          injection: {
            'example.toolbar': injectionReplacement,
            'example.sidebar': null,
          },
          dashboard: {
            'example.kpi': dashboardReplacement,
          },
          components: {
            'page:/backend/example': componentReplacement,
          },
        },
        notifications: {
          types: { 'example.notice': notificationTypeReplacement },
          handlers: {
            'example.notice.toast': notificationHandlerReplacement,
            'example.notice.popup': null,
          },
        },
        interceptors: { 'example.items.interceptor': apiInterceptorReplacement },
        commandInterceptors: {
          'example.command.interceptor': commandInterceptorReplacement,
        },
        enrichers: { 'example.items.enricher': enricherReplacement },
        guards: { 'example.backend.guard': guardReplacement },
      }),
    ])

    expect(applyInjectionWidgetOverridesToEntries([
      { moduleId: 'base', key: 'example.toolbar', source: 'package', loader: jest.fn() },
      { moduleId: 'base', key: 'example.sidebar', source: 'package', loader: jest.fn() },
    ])).toEqual([injectionReplacement])

    expect(applyDashboardWidgetOverridesToEntries([
      { moduleId: 'base', key: 'example.kpi', source: 'package', loader: jest.fn() },
    ])).toEqual([dashboardReplacement])

    const componentEntries = applyComponentOverridesToEntries([
      {
        moduleId: 'base',
        componentOverrides: [
          {
            target: { componentId: 'page:/backend/example' },
            priority: 20,
            propsTransform: (props: unknown) => props,
          },
        ],
      },
    ])
    expect(componentEntries.flatMap((entry) => entry.componentOverrides)).toEqual([componentReplacement])

    expect(applyNotificationTypeOverridesToEntries([
      {
        moduleId: 'base',
        types: [
          { type: 'example.notice', module: 'example', titleKey: 'old', icon: 'bell', severity: 'info', actions: [] },
        ],
      },
    ])).toEqual([{ moduleId: 'base', types: [notificationTypeReplacement] }])

    expect(applyNotificationHandlerOverridesToEntries([
      {
        moduleId: 'base',
        handlers: [
          { id: 'example.notice.toast', notificationType: 'example.notice', handle: jest.fn() },
          { id: 'example.notice.popup', notificationType: 'example.notice', handle: jest.fn() },
        ],
      },
    ])).toEqual([{ moduleId: 'base', handlers: [notificationHandlerReplacement] }])

    expect(applyApiInterceptorOverridesToEntries([
      {
        moduleId: 'base',
        interceptors: [
          { id: 'example.items.interceptor', targetRoute: '/api/example/items', methods: ['POST'] },
        ],
      },
    ])).toEqual([{ moduleId: 'base', interceptors: [apiInterceptorReplacement] }])

    expect(applyCommandInterceptorOverridesToEntries([
      {
        moduleId: 'base',
        interceptors: [
          { id: 'example.command.interceptor', targetCommand: 'example.old' },
        ],
      },
    ])).toEqual([{ moduleId: 'base', interceptors: [commandInterceptorReplacement] }])

    expect(applyResponseEnricherOverridesToEntries([
      {
        moduleId: 'base',
        enrichers: [
          { id: 'example.items.enricher', targetEntity: 'example.item', enrichOne: jest.fn() },
        ],
      },
    ])).toEqual([{ moduleId: 'base', enrichers: [enricherReplacement] }])

    expect(applyPageGuardOverridesToEntries([
      {
        moduleId: 'base',
        middleware: [
          { id: 'example.backend.guard', target: '/backend/example', run: jest.fn() },
        ],
      },
    ])).toEqual([{ moduleId: 'base', middleware: [guardReplacement] }])
  })

  it('removes disabled injection widgets from injection tables', () => {
    applyModuleOverridesFromEnabledModules([
      makeEnabledModule({
        widgets: {
          injection: { 'example.sidebar': null },
        },
      }),
    ])

    expect(applyInjectionWidgetOverridesToTables([
      {
        moduleId: 'example',
        table: {
          'backend.sidebar': [
            'example.sidebar',
            { widgetId: 'example.toolbar', priority: 10 },
          ],
          'backend.footer': 'example.sidebar',
        },
      },
    ])).toEqual([
      {
        moduleId: 'example',
        table: {
          'backend.sidebar': [{ widgetId: 'example.toolbar', priority: 10 }],
        },
      },
    ])
  })

  it('applies DI binding overrides as the last container mutation step', () => {
    const register = jest.fn()
    const unregister = jest.fn()

    applyModuleOverridesFromEnabledModules([
      makeEnabledModule({
        di: {
          disabledService: null,
          valueService: { enabled: true },
          customService: {
            register: (container, key) => container.register({ [key]: 'registered by override' }),
          },
        },
      }),
    ])

    applyDiOverridesToContainer({ register, unregister })

    expect(unregister).toHaveBeenCalledWith('disabledService')
    expect(register).toHaveBeenCalledWith({ valueService: { enabled: true } })
    expect(register).toHaveBeenCalledWith({ customService: 'registered by override' })
  })
})
