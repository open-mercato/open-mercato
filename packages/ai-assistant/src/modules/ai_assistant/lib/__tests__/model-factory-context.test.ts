import { createContainer } from 'awilix'
import { createModelFactory, type AiModelResolution } from '../model-factory'
import { withModelFactoryOverride, withModelFactoryToolScope } from '../model-factory-context'

const resolution: AiModelResolution = {
  model: {}, modelId: 'synthetic-model', providerId: 'synthetic', source: 'provider_default', supportsInputModeration: false,
}

it('intercepts before credential lookup and restores normal resolution after exceptions', async () => {
  const resolveLive = jest.fn(() => { throw new Error('live lookup') })
  const factory = createModelFactory(createContainer(), { registry: { resolveFirstConfigured: resolveLive }, env: {} })
  await expect(withModelFactoryOverride(() => resolution, async () => {
    expect(factory.resolveModel({})).toBe(resolution)
    throw new Error('caller failure')
  })).rejects.toThrow('caller failure')
  expect(resolveLive).not.toHaveBeenCalled()
  expect(() => factory.resolveModel({})).toThrow('live lookup')
})

it('keeps parallel and nested overrides isolated', async () => {
  const factory = createModelFactory(createContainer())
  await Promise.all(['first', 'second'].map((modelId) => withModelFactoryOverride(() => ({ ...resolution, modelId }), async () => {
    await Promise.resolve()
    expect(factory.resolveModel({}).modelId).toBe(modelId)
    await withModelFactoryOverride(() => ({ ...resolution, modelId: 'nested' }), async () => {
      expect(factory.resolveModel({}).modelId).toBe('nested')
    })
    expect(factory.resolveModel({}).modelId).toBe(modelId)
  })))
})

it('can exclude nested tool inference while retaining the parent override', async () => {
  const resolveLive = jest.fn(() => { throw new Error('live tool model') })
  const factory = createModelFactory(createContainer(), { registry: { resolveFirstConfigured: resolveLive }, env: {} })
  await withModelFactoryOverride(() => resolution, async () => {
    await expect(withModelFactoryToolScope(async () => factory.resolveModel({}))).rejects.toThrow('live tool model')
    expect(factory.resolveModel({})).toBe(resolution)
  }, { isolateTools: true })
  expect(resolveLive).toHaveBeenCalledTimes(1)
})
