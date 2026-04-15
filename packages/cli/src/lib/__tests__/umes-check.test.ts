import type { UmesModuleData } from '../umes/collector'

const mockCreateResolver = jest.fn()
const mockCollectUmesData = jest.fn()
const mockDetectConflicts = jest.fn()

jest.mock('../resolver', () => ({
  createResolver: mockCreateResolver,
}))

jest.mock('../umes/collector', () => ({
  collectUmesData: mockCollectUmesData,
}))

jest.mock('@open-mercato/shared/lib/umes/conflict-detection', () => ({
  detectConflicts: mockDetectConflicts,
}))

import { runUmesCheck } from '../umes/check'

describe('runUmesCheck', () => {
  const originalExitCode = process.exitCode
  const resolver = { kind: 'resolver' }

  beforeEach(() => {
    jest.clearAllMocks()
    process.exitCode = undefined
    mockCreateResolver.mockReturnValue(resolver)
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  afterAll(() => {
    process.exitCode = originalExitCode
  })

  it('flattens UMES module data for conflict detection and reports clean runs', async () => {
    const modulesData: UmesModuleData[] = [
      {
        moduleId: 'catalog',
        declaredFeatures: ['catalog.view', 'catalog.manage'],
        extensions: [
          {
            moduleId: 'catalog',
            type: 'component-override',
            id: 'catalog.page.home',
            target: 'page:home',
            priority: 100,
            features: ['catalog.view'],
          },
          {
            moduleId: 'catalog',
            type: 'interceptor',
            id: 'catalog.api.search',
            target: 'GET catalog/search',
            priority: 25,
            features: ['catalog.manage'],
            details: {
              targetRoute: 'catalog/search',
              methods: ['GET'],
            },
          },
          {
            moduleId: 'catalog',
            type: 'injection-widget',
            id: 'catalog.widgets.badge',
            target: 'data-table:catalog',
            priority: 10,
            features: ['catalog.view'],
          },
        ],
      },
      {
        moduleId: 'inventory',
        declaredFeatures: ['inventory.view'],
        extensions: [
          {
            moduleId: 'inventory',
            type: 'interceptor',
            id: 'inventory.api.stock',
            target: 'inventory/stock',
            priority: 50,
            details: {
              methods: ['POST'],
            },
          },
          {
            moduleId: 'inventory',
            type: 'enricher',
            id: 'inventory.enricher',
            target: 'products.variant',
            priority: 0,
          },
        ],
      },
    ]

    mockCollectUmesData.mockReturnValue(modulesData)
    mockDetectConflicts.mockReturnValue({ warnings: [], errors: [] })

    await runUmesCheck()

    expect(mockCreateResolver).toHaveBeenCalledTimes(1)
    expect(mockCollectUmesData).toHaveBeenCalledWith(resolver)
    expect(mockDetectConflicts).toHaveBeenCalledWith({
      componentOverrides: [
        {
          moduleId: 'catalog',
          componentId: 'page:home',
          priority: 100,
        },
      ],
      interceptors: [
        {
          moduleId: 'catalog',
          id: 'catalog.api.search',
          targetRoute: 'catalog/search',
          methods: ['GET'],
          priority: 25,
        },
        {
          moduleId: 'inventory',
          id: 'inventory.api.stock',
          targetRoute: 'inventory/stock',
          methods: ['POST'],
          priority: 50,
        },
      ],
      gatedExtensions: [
        {
          moduleId: 'catalog',
          extensionId: 'catalog.page.home',
          features: ['catalog.view'],
        },
        {
          moduleId: 'catalog',
          extensionId: 'catalog.api.search',
          features: ['catalog.manage'],
        },
        {
          moduleId: 'catalog',
          extensionId: 'catalog.widgets.badge',
          features: ['catalog.view'],
        },
      ],
      declaredFeatures: new Set(['catalog.view', 'catalog.manage', 'inventory.view']),
    })
    expect(console.log).toHaveBeenNthCalledWith(1, 'Running UMES conflict detection...\n')
    expect(console.log).toHaveBeenNthCalledWith(2, '\x1b[32mNo conflicts found.\x1b[0m')
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
  })

  it('prints warnings and leaves the process exit code untouched when only warnings exist', async () => {
    mockCollectUmesData.mockReturnValue([])
    mockDetectConflicts.mockReturnValue({
      warnings: [{ message: 'Multiple interceptors share a priority.' }],
      errors: [],
    })

    await runUmesCheck()

    expect(console.warn).toHaveBeenCalledWith(
      '\x1b[33m[Warning]\x1b[0m Multiple interceptors share a priority.',
    )
    expect(console.error).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenLastCalledWith('\nSummary: 0 error(s), 1 warning(s)')
    expect(process.exitCode).toBeUndefined()
  })

  it('falls back to interceptor targets and empty methods when extension details are missing', async () => {
    const modulesData: UmesModuleData[] = [
      {
        moduleId: 'catalog',
        declaredFeatures: ['catalog.view'],
        extensions: [
          {
            moduleId: 'catalog',
            type: 'interceptor',
            id: 'catalog.api.export',
            target: 'catalog/export',
            priority: 75,
            features: [],
          },
        ],
      },
    ]

    mockCollectUmesData.mockReturnValue(modulesData)
    mockDetectConflicts.mockReturnValue({ warnings: [], errors: [] })

    await runUmesCheck()

    expect(mockDetectConflicts).toHaveBeenCalledWith({
      componentOverrides: [],
      interceptors: [
        {
          moduleId: 'catalog',
          id: 'catalog.api.export',
          targetRoute: 'catalog/export',
          methods: [],
          priority: 75,
        },
      ],
      gatedExtensions: [],
      declaredFeatures: new Set(['catalog.view']),
    })
    expect(console.log).toHaveBeenNthCalledWith(2, '\x1b[32mNo conflicts found.\x1b[0m')
    expect(process.exitCode).toBeUndefined()
  })

  it('prints errors, includes the summary, and sets process.exitCode when conflicts are fatal', async () => {
    mockCollectUmesData.mockReturnValue([])
    mockDetectConflicts.mockReturnValue({
      warnings: [{ message: 'One warning remains.' }],
      errors: [{ message: 'Two modules replace the same component.' }],
    })

    await runUmesCheck()

    expect(console.warn).toHaveBeenCalledWith('\x1b[33m[Warning]\x1b[0m One warning remains.')
    expect(console.error).toHaveBeenCalledWith(
      '\x1b[31m[Error]\x1b[0m Two modules replace the same component.',
    )
    expect(console.log).toHaveBeenLastCalledWith('\nSummary: 1 error(s), 1 warning(s)')
    expect(process.exitCode).toBe(1)
  })
})
