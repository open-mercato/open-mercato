import type { PackageResolver } from '../../resolver'
import { createResolver } from '../../resolver'
import { collectUmesData, type UmesModuleData } from '../collector'
import { runUmesInspect } from '../inspect'

jest.mock('../../resolver', () => ({
  createResolver: jest.fn(),
}))

jest.mock('../collector', () => ({
  collectUmesData: jest.fn(),
}))

const mockedCreateResolver = createResolver as jest.MockedFunction<typeof createResolver>
const mockedCollectUmesData = collectUmesData as jest.MockedFunction<typeof collectUmesData>

function createConsoleRecorder() {
  const logLines: string[] = []
  const errorLines: string[] = []

  const logSpy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logLines.push(args.map((arg) => String(arg)).join(' '))
  })
  const errorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errorLines.push(args.map((arg) => String(arg)).join(' '))
  })

  return {
    errorLines,
    errorSpy,
    logLines,
    logSpy,
  }
}

describe('runUmesInspect', () => {
  let previousExitCode: number | undefined
  let resolver: PackageResolver

  beforeEach(() => {
    previousExitCode = process.exitCode
    process.exitCode = undefined
    jest.clearAllMocks()
    resolver = {} as PackageResolver
    mockedCreateResolver.mockReturnValue(resolver)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    process.exitCode = previousExitCode
  })

  it('prints grouped UMES sections and skips falsey detail fields', async () => {
    const recorder = createConsoleRecorder()
    const modulesData: UmesModuleData[] = [
      {
        moduleId: 'example',
        declaredFeatures: ['example.view', 'example.manage'],
        extensions: [
          {
            moduleId: 'example',
            type: 'enricher',
            id: 'example.person.enricher',
            target: 'customers.person',
            priority: 10,
            features: ['example.view'],
            details: {
              critical: true,
              hasCache: false,
              timeout: 5_000,
            },
          },
          {
            moduleId: 'example',
            type: 'interceptor',
            id: 'example.people.list',
            target: 'GET /api/customers/people',
            priority: 20,
            features: ['example.manage'],
            details: {
              hasAfter: false,
              hasBefore: true,
              methods: 'GET',
              targetRoute: '/api/customers/people',
            },
          },
          {
            moduleId: 'example',
            type: 'component-override',
            id: 'example.page.dashboard',
            target: 'page:dashboard',
            priority: 30,
            details: {
              overrideKind: 'wrapper',
            },
          },
          {
            moduleId: 'example',
            type: 'injection-widget',
            id: 'example.customer_badge',
            target: 'customer:header',
            priority: 40,
          },
        ],
      },
    ]
    mockedCollectUmesData.mockReturnValue(modulesData)

    await runUmesInspect('example')

    expect(mockedCreateResolver).toHaveBeenCalledTimes(1)
    expect(mockedCollectUmesData).toHaveBeenCalledWith(resolver)
    expect(recorder.errorSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()

    const output = recorder.logLines.join('\n')
    expect(output).toContain('UMES Extensions for module: example')
    expect(output).toContain('Declared Features (2):')
    expect(output).toContain('  - example.view')
    expect(output).toContain('  - example.manage')
    expect(output).toContain('Response Enrichers (1):')
    expect(output).toContain('API Interceptors (1):')
    expect(output).toContain('Component Overrides (1):')
    expect(output).toContain('Injection Widgets (1):')
    expect(output).toContain('features: example.view')
    expect(output).toContain('features: example.manage')
    expect(output).toContain('critical: true')
    expect(output).toContain('timeout: 5000')
    expect(output).toContain('hasBefore: true')
    expect(output).toContain('targetRoute: /api/customers/people')
    expect(output).toContain('overrideKind: wrapper')
    expect(output).not.toContain('hasAfter: false')
    expect(output).not.toContain('hasCache: false')
    expect(output.indexOf('Response Enrichers')).toBeLessThan(output.indexOf('API Interceptors'))
    expect(output.indexOf('API Interceptors')).toBeLessThan(output.indexOf('Component Overrides'))
    expect(output.indexOf('Component Overrides')).toBeLessThan(output.indexOf('Injection Widgets'))
  })

  it('prints an empty-state message when a module has no UMES extensions', async () => {
    const recorder = createConsoleRecorder()
    mockedCollectUmesData.mockReturnValue([
      {
        moduleId: 'empty_module',
        declaredFeatures: [],
        extensions: [],
      },
    ])

    await runUmesInspect('empty_module')

    expect(recorder.errorSpy).not.toHaveBeenCalled()
    expect(recorder.logLines.join('\n')).toContain('No UMES extensions found for this module.')
    expect(recorder.logLines.join('\n')).not.toContain('Declared Features')
  })

  it('sets exit code and reports available modules when the target module is missing', async () => {
    const recorder = createConsoleRecorder()
    mockedCollectUmesData.mockReturnValue([
      {
        moduleId: 'customers',
        declaredFeatures: [],
        extensions: [],
      },
      {
        moduleId: 'example',
        declaredFeatures: [],
        extensions: [],
      },
    ])

    await runUmesInspect('missing_module')

    expect(recorder.logSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(recorder.errorLines).toEqual([
      'Module "missing_module" not found. Available modules: customers, example',
    ])
  })
})
