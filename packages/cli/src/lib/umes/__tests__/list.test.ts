import type { PackageResolver } from '../../resolver'
import type { UmesModuleData } from '../collector'

describe('runUmesList', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.restoreAllMocks()
  })

  afterEach(() => {
    jest.dontMock('../../resolver')
    jest.dontMock('../collector')
    jest.resetModules()
    jest.restoreAllMocks()
  })

  async function loadSubject(modulesData: UmesModuleData[]) {
    const resolver = { kind: 'resolver' } as unknown as PackageResolver
    const createResolver = jest.fn(() => resolver)
    const collectUmesData = jest.fn(() => modulesData)

    jest.doMock('../../resolver', () => ({ createResolver }))
    jest.doMock('../collector', () => ({ collectUmesData }))

    const { runUmesList } = await import('../list')

    return {
      runUmesList,
      resolver,
      createResolver,
      collectUmesData,
    }
  }

  it('logs an empty state when no UMES extensions are found', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const { runUmesList, resolver, createResolver, collectUmesData } = await loadSubject([])

    await runUmesList()

    expect(createResolver).toHaveBeenCalledTimes(1)
    expect(collectUmesData).toHaveBeenCalledWith(resolver)
    expect(consoleLogSpy.mock.calls).toEqual([
      ['No UMES extensions found.'],
    ])
  })

  it('renders a formatted table with a summary for discovered extensions', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const modulesData: UmesModuleData[] = [
      {
        moduleId: 'alpha',
        declaredFeatures: ['alpha.view'],
        extensions: [
          {
            moduleId: 'alpha',
            type: 'enricher',
            id: 'alpha.enrich',
            target: '*',
            priority: 7,
            features: ['alpha.view'],
          },
        ],
      },
      {
        moduleId: 'beta_mod',
        declaredFeatures: [],
        extensions: [
          {
            moduleId: 'beta_mod',
            type: 'interceptor',
            id: 'beta.guard',
            target: 'GET /orders',
            priority: 12,
          },
        ],
      },
      {
        moduleId: 'gamma',
        declaredFeatures: ['gamma.view'],
        extensions: [],
      },
    ]
    const { runUmesList, resolver, createResolver, collectUmesData } = await loadSubject(modulesData)

    await runUmesList()

    const output = consoleLogSpy.mock.calls.map(([message]) => String(message))

    expect(createResolver).toHaveBeenCalledTimes(1)
    expect(collectUmesData).toHaveBeenCalledWith(resolver)
    expect(output).toHaveLength(5)
    expect(output[0].replace(/\s+$/u, '')).toBe(
      ' Module   │ Type        │ ID           │ Target      │ Priority │ Features'
    )
    expect(output[1]).toMatch(/^─+┼─+┼─+┼─+┼─+┼─+$/u)
    expect(output[2].replace(/\s+$/u, '')).toBe(
      ' alpha    │ enricher    │ alpha.enrich │ *           │ 7        │ alpha.view'
    )
    expect(output[3].replace(/\s+$/u, '')).toBe(
      ' beta_mod │ interceptor │ beta.guard   │ GET /orders │ 12       │'
    )
    expect(output[4]).toBe('\nTotal: 2 extension(s) across 2 module(s)')
  })
})
