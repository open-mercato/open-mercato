import path from 'node:path'
import { runGenerateWatchSuite } from '../generate-watch-runner'
import type { GenerateWatchGroup, GenerateWatchPlan } from '../generate-watch-plan'
import { createResolver } from '../resolver'
import * as generators from '../generators'
import { getOpenApiGeneratorDependencies } from '../generators/openapi'

jest.mock('../resolver', () => ({ createResolver: jest.fn(() => ({ fixture: true })) }))
jest.mock('../generators/openapi', () => ({ getOpenApiGeneratorDependencies: jest.fn(() => []) }))
jest.mock('../generators', () => ({
  generateEntityIds: jest.fn(),
  generateModuleRegistries: jest.fn(),
  generateModuleEntities: jest.fn(),
  generateModuleDi: jest.fn(),
  generateModulePackageSources: jest.fn(),
  generateWebResearchAdapters: jest.fn(),
  generateOpenApi: jest.fn(),
}))

const allGroups: GenerateWatchGroup[] = ['entity-ids', 'registry', 'entities', 'di', 'package-sources', 'web-research-adapters', 'openapi']
const calls: GenerateWatchGroup[] = []
const unchanged = { filesWritten: [], filesUnchanged: ['unchanged'], errors: [] }

function selectedPlan(groups: GenerateWatchGroup[], registryOutputs: string[] = []): GenerateWatchPlan {
  return { mode: 'incremental', groups, registryOutputs, changes: [], reasons: [] }
}

describe('runGenerateWatchSuite', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    calls.length = 0
    jest.mocked(generators.generateEntityIds).mockImplementation(async () => { calls.push('entity-ids'); return unchanged })
    jest.mocked(getOpenApiGeneratorDependencies).mockReturnValue([])
    jest.mocked(generators.generateModuleRegistries).mockImplementation(async () => { calls.push('registry'); return [unchanged] })
    jest.mocked(generators.generateModuleEntities).mockImplementation(async () => { calls.push('entities'); return unchanged })
    jest.mocked(generators.generateModuleDi).mockImplementation(async () => { calls.push('di'); return unchanged })
    jest.mocked(generators.generateModulePackageSources).mockImplementation(async () => { calls.push('package-sources'); return unchanged })
    jest.mocked(generators.generateWebResearchAdapters).mockImplementation(async () => { calls.push('web-research-adapters'); return unchanged })
    jest.mocked(generators.generateOpenApi).mockImplementation(async () => { calls.push('openapi'); return unchanged })
  })

  it('runs only selected groups in canonical dependency order and limits registry outputs', async () => {
    const resolver = createResolver()
    const plan = selectedPlan(['openapi', 'di', 'registry', 'entity-ids'], ['api-routes'])
    expect(await runGenerateWatchSuite(true, plan, resolver)).toBe(false)
    expect(calls).toEqual(['entity-ids', 'registry', 'di', 'openapi'])
    expect(generators.generateModuleRegistries).toHaveBeenCalledWith({ resolver, quiet: true, outputGroups: ['api-routes'] })
  })

  it('does not enter unrelated generators for a single DI edit', async () => {
    await runGenerateWatchSuite(true, selectedPlan(['di']))
    expect(calls).toEqual(['di'])
  })

  it.each(['explicit', 'fallback'])('runs the complete suite for %s generation without an output filter', async (mode) => {
    const plan: GenerateWatchPlan | undefined = mode === 'explicit'
      ? undefined
      : { mode: 'full', groups: [], registryOutputs: ['api-routes'], changes: [], reasons: ['unknown source'] }
    await runGenerateWatchSuite(true, plan)
    expect(calls).toEqual(allGroups)
    expect(generators.generateModuleRegistries).toHaveBeenCalledWith({ resolver: createResolver(), quiet: true })
  })

  it('does no resolver or generator work for a no-op plan', async () => {
    expect(await runGenerateWatchSuite(true, { mode: 'none', groups: [], registryOutputs: [], changes: [], reasons: [] })).toBe(false)
    expect(calls).toEqual([])
    expect(createResolver).not.toHaveBeenCalled()
  })

  it('reports changed output bytes even if a later selected group is unchanged', async () => {
    jest.mocked(generators.generateModuleDi).mockResolvedValueOnce({ ...unchanged, filesWritten: ['di.generated.ts'] })
    expect(await runGenerateWatchSuite(true, selectedPlan(['di', 'openapi']))).toBe(true)
  })

  it('propagates a failed suite and never runs later dependent groups', async () => {
    jest.mocked(generators.generateModuleRegistries).mockRejectedValueOnce(new Error('registry failed'))
    await expect(runGenerateWatchSuite(true)).rejects.toThrow('registry failed')
    expect(calls).toEqual(['entity-ids'])
    expect(generators.generateModuleEntities).not.toHaveBeenCalled()
    expect(generators.generateOpenApi).not.toHaveBeenCalled()
  })

  it('does not report a generator result containing errors as successful generation', async () => {
    jest.mocked(generators.generateModuleDi).mockResolvedValueOnce({ ...unchanged, errors: ['unable to generate DI'] })
    await expect(runGenerateWatchSuite(true, selectedPlan(['di', 'openapi']))).rejects.toThrow('unable to generate DI')
    expect(generators.generateOpenApi).not.toHaveBeenCalled()
  })

  it('cascades a changed generated dependency using the graph captured before producer execution', async () => {
    const generatedPath = path.resolve('/virtual/app/.mercato/generated/di.generated.ts')
    jest.mocked(getOpenApiGeneratorDependencies).mockReturnValue([generatedPath])
    jest.mocked(generators.generateModuleDi).mockImplementationOnce(async () => {
      calls.push('di')
      jest.mocked(getOpenApiGeneratorDependencies).mockReturnValue([])
      return { ...unchanged, filesWritten: [generatedPath] }
    })
    const cascade = jest.fn()
    expect(await runGenerateWatchSuite(true, selectedPlan(['di']), undefined, cascade)).toBe(true)
    expect(calls).toEqual(['di', 'openapi'])
    expect(cascade).toHaveBeenCalledTimes(1)
  })

  it('cascades deletion of a generated directory containing an imported entity field file', async () => {
    const generatedDirectory = path.resolve('/virtual/app/.mercato/generated/entities/retired')
    jest.mocked(getOpenApiGeneratorDependencies).mockReturnValue([path.join(generatedDirectory, 'index.ts')])
    jest.mocked(generators.generateEntityIds).mockResolvedValueOnce({ ...unchanged, filesWritten: [generatedDirectory] })
    await runGenerateWatchSuite(true, selectedPlan(['entity-ids']))
    expect(generators.generateOpenApi).toHaveBeenCalledTimes(1)
  })

  it.each([{ dependencies: [] }, { dependencies: [path.resolve('/virtual/unrelated.ts')] }])('does not cascade unrelated byte changes with a known graph $dependencies', async ({ dependencies }) => {
    jest.mocked(getOpenApiGeneratorDependencies).mockReturnValue(dependencies)
    jest.mocked(generators.generateModuleDi).mockResolvedValueOnce({ ...unchanged, filesWritten: ['/virtual/di.generated.ts'] })
    await runGenerateWatchSuite(true, selectedPlan(['di']))
    expect(generators.generateOpenApi).not.toHaveBeenCalled()
  })

  it('conservatively cascades unknown graphs only after a producer changes output bytes', async () => {
    jest.mocked(getOpenApiGeneratorDependencies).mockReturnValue(null)
    await runGenerateWatchSuite(true, selectedPlan(['di']))
    expect(generators.generateOpenApi).not.toHaveBeenCalled()
    jest.mocked(generators.generateModuleDi).mockResolvedValueOnce({ ...unchanged, filesWritten: ['/virtual/di.generated.ts'] })
    await runGenerateWatchSuite(true, selectedPlan(['di']))
    expect(generators.generateOpenApi).toHaveBeenCalledTimes(1)
  })
})
