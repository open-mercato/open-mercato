import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'

const createBootstrapMock = jest.fn(() => jest.fn())
const registerAppDictionaryLoaderMock = jest.fn()
const registerEventModuleConfigsMock = jest.fn()
const registerMessageTypesMock = jest.fn()
const registerMessageObjectTypesMock = jest.fn()
const runBootstrapRegistrationsMock = jest.fn()
const appDiRegistrarMock = jest.fn()
const loggerMock = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
}
loggerMock.child.mockImplementation(() => loggerMock)

function makeCodeWorkflow(workflowId: string, valid = true): CodeWorkflowDefinition {
  return {
    workflowId,
    workflowName: `Workflow ${workflowId}`,
    description: null,
    version: 1,
    enabled: true,
    metadata: null,
    moduleId: 'test-module',
    definition: valid
      ? {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            {
              transitionId: 'start-to-end',
              fromStepId: 'start',
              toStepId: 'end',
              trigger: 'auto',
              priority: 0,
            },
          ],
        }
      : {
          steps: [],
          transitions: [],
        },
  }
}

function mockBootstrapDependencies({
  fullModules = [],
  appModules = [],
  bootstrapModules = [],
  codeWorkflows = [],
}: {
  fullModules?: object[]
  appModules?: object[]
  bootstrapModules?: object[]
  codeWorkflows?: CodeWorkflowDefinition[]
} = {}) {
  jest.doMock('@open-mercato/shared/lib/i18n/server', () => ({
    registerAppDictionaryLoader: registerAppDictionaryLoaderMock,
  }))
  jest.doMock('@/.mercato/generated/modules.generated', () => ({ modules: fullModules }))
  jest.doMock('@/.mercato/generated/modules.app.generated', () => ({ modules: appModules }))
  jest.doMock('@/.mercato/generated/modules.bootstrap.generated', () => ({ modules: bootstrapModules }), { virtual: true })
  jest.doMock('@/.mercato/generated/entities.generated', () => ({ entities: [] }))
  jest.doMock('@/.mercato/generated/di.generated', () => ({ diRegistrars: [] }))
  jest.doMock('@/.mercato/generated/entities.ids.generated', () => ({ E: {} }))
  jest.doMock('@/.mercato/generated/entity-fields-registry', () => ({ entityFieldsRegistry: {} }))
  jest.doMock('@/.mercato/generated/dashboard-widgets.generated', () => ({ dashboardWidgetEntries: [] }))
  jest.doMock('@/.mercato/generated/injection-widgets.generated', () => ({ injectionWidgetEntries: [] }))
  jest.doMock('@/.mercato/generated/translations-fields.generated', () => ({}))
  jest.doMock('@/.mercato/generated/injection-tables.generated', () => ({ injectionTables: [] }))
  jest.doMock('@/.mercato/generated/search.generated', () => ({ searchModuleConfigs: [] }))
  jest.doMock('@/.mercato/generated/events.generated', () => ({ eventModuleConfigs: [], allEvents: [] }))
  jest.doMock('@/.mercato/generated/analytics.generated', () => ({ analyticsModuleConfigs: [] }))
  jest.doMock('@/.mercato/generated/enrichers.generated', () => ({ enricherEntries: [] }))
  jest.doMock('@/.mercato/generated/interceptors.generated', () => ({ interceptorEntries: [] }))
  jest.doMock('@/.mercato/generated/component-overrides.generated', () => ({ componentOverrideEntries: [] }))
  jest.doMock('@/.mercato/generated/guards.generated', () => ({ guardEntries: [] }))
  jest.doMock('@/.mercato/generated/command-interceptors.generated', () => ({ commandInterceptorEntries: [] }))
  jest.doMock('@/.mercato/generated/command-loaders.generated', () => ({ commandLoaderEntries: [] }))
  jest.doMock('@/.mercato/generated/notification-handlers.generated', () => ({ notificationHandlerEntries: [] }))
  jest.doMock('@/.mercato/generated/message-types.generated', () => ({ messageTypes: [] }))
  jest.doMock('@/.mercato/generated/message-objects.generated', () => ({ messageObjectTypes: [] }))
  jest.doMock('@/.mercato/generated/workflows.generated', () => ({ allCodeWorkflows: codeWorkflows }))
  jest.doMock('@/.mercato/generated/bootstrap-registrations.generated', () => ({
    runBootstrapRegistrations: runBootstrapRegistrationsMock,
  }))
  jest.doMock('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-overrides', () => ({}))
  jest.doMock('@open-mercato/shared/lib/logger', () => ({
    createLogger: jest.fn(() => loggerMock),
  }))
  jest.doMock('@/di', () => ({ register: appDiRegistrarMock }))
  jest.doMock('@open-mercato/shared/modules/events', () => ({
    registerEventModuleConfigs: registerEventModuleConfigsMock,
  }))
  jest.doMock('@open-mercato/core/modules/messages/lib/message-types-registry', () => ({
    registerMessageTypes: registerMessageTypesMock,
  }))
  jest.doMock('@open-mercato/core/modules/messages/lib/message-objects-registry', () => ({
    registerMessageObjectTypes: registerMessageObjectTypesMock,
  }))
  jest.doMock('@open-mercato/shared/lib/bootstrap', () => ({
    createBootstrap: createBootstrapMock,
    isBootstrapped: jest.fn(() => false),
  }))
}

describe('app bootstrap', () => {
  beforeEach(() => {
    jest.resetModules()
    createBootstrapMock.mockClear()
    registerAppDictionaryLoaderMock.mockClear()
    registerEventModuleConfigsMock.mockClear()
    registerMessageTypesMock.mockClear()
    registerMessageObjectTypesMock.mockClear()
    runBootstrapRegistrationsMock.mockClear()
    appDiRegistrarMock.mockClear()
    loggerMock.warn.mockClear()
  })

  it('registers the bootstrap module manifest instead of route-aware registries', async () => {
    const fullModules = [{ id: 'full', backendRoutes: [{ pattern: '/backend/customers' }] }]
    const appModules = [{ id: 'app-only' }]
    const bootstrapModules = [{ id: 'bootstrap-only' }]

    mockBootstrapDependencies({ fullModules, appModules, bootstrapModules })

    await import('@/bootstrap')

    expect(createBootstrapMock).toHaveBeenCalledTimes(1)
    expect(createBootstrapMock.mock.calls[0][0].modules).toBe(bootstrapModules)
    expect(createBootstrapMock.mock.calls[0][0].modules).not.toBe(fullModules)
    expect(createBootstrapMock.mock.calls[0][0].modules).not.toBe(appModules)
    expect(createBootstrapMock.mock.calls[0][1]).toEqual({
      appDiRegistrar: appDiRegistrarMock,
      registrationKey: 'full',
    })
  })

  it('rejects invalid code workflow definitions before app bootstrap registration', async () => {
    const invalidWorkflow = makeCodeWorkflow('invalid-workflow', false)
    const validWorkflow = makeCodeWorkflow('valid-workflow')
    mockBootstrapDependencies({ codeWorkflows: [invalidWorkflow, validWorkflow] })

    await import('@/bootstrap-common')

    const { getCodeWorkflow } = await import('@open-mercato/core/modules/workflows/lib/code-registry')
    expect(getCodeWorkflow('invalid-workflow')).toBeUndefined()
    expect(getCodeWorkflow('valid-workflow')).toEqual(validWorkflow)
  })
})
