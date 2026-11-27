import {
  getFulltextDriverFactory,
  listFulltextDriverFactories,
  registerFulltextDriverFactory,
  resolveFulltextDriverSelection,
  type FulltextDriverFactory,
} from '../fulltext/drivers/registry'

const REGISTRY_KEY = Symbol.for('@open-mercato/search/fulltext-driver-registry')

function factory(id: string, configuredWhen: string): FulltextDriverFactory {
  return {
    id,
    describe: () => ({ id, label: id, envVars: [{ name: configuredWhen, required: true, hintKey: 'k', hint: 'h' }] }),
    isConfigured: (env = process.env) => Boolean(env[configuredWhen]),
    create: () => ({ id } as never),
  }
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY]
})

describe('fulltext driver registry', () => {
  it('registers, lists in registration order, and unregisters only the same instance', () => {
    const first = factory('first', 'FIRST_URL')
    const second = factory('second', 'SECOND_URL')
    const unregisterFirst = registerFulltextDriverFactory(first)
    registerFulltextDriverFactory(second)
    expect(listFulltextDriverFactories().map((entry) => entry.id)).toEqual(['first', 'second'])

    const replacement = factory('first', 'FIRST_URL')
    registerFulltextDriverFactory(replacement)
    expect(getFulltextDriverFactory('first')).toBe(replacement)

    unregisterFirst()
    expect(getFulltextDriverFactory('first')).toBe(replacement)
    expect(getFulltextDriverFactory('missing')).toBeNull()
  })

  it('keeps one registry across duplicated module instances', () => {
    registerFulltextDriverFactory(factory('shared', 'SHARED_URL'))
    jest.isolateModules(() => {
      const duplicate = require('../fulltext/drivers/registry') as typeof import('../fulltext/drivers/registry')
      expect(duplicate.getFulltextDriverFactory('shared')?.id).toBe('shared')
    })
  })

  it('selects by FULLTEXT_DRIVER when set', () => {
    const factories = [factory('alpha', 'ALPHA_URL'), factory('beta', 'BETA_URL')]
    expect(resolveFulltextDriverSelection({ FULLTEXT_DRIVER: 'beta', BETA_URL: 'x' }, factories)).toEqual({ id: 'beta', source: 'env', requested: 'beta' })
    expect(resolveFulltextDriverSelection({ FULLTEXT_DRIVER: ' Beta ', BETA_URL: 'x' }, factories).id).toBe('beta')
    expect(resolveFulltextDriverSelection({ FULLTEXT_DRIVER: 'beta' }, factories)).toEqual({ id: null, source: 'env', requested: 'beta', reason: 'unconfigured' })
    expect(resolveFulltextDriverSelection({ FULLTEXT_DRIVER: 'gamma', ALPHA_URL: 'x' }, factories)).toEqual({ id: null, source: 'env', requested: 'gamma', reason: 'unknown' })
  })

  it('auto-detects the single configured driver and prefers meilisearch when ambiguous', () => {
    const factories = [factory('meilisearch', 'MEILISEARCH_HOST'), factory('beta', 'BETA_URL')]
    expect(resolveFulltextDriverSelection({}, factories)).toEqual({ id: null, source: 'none' })
    expect(resolveFulltextDriverSelection({ BETA_URL: 'x' }, factories)).toEqual({ id: 'beta', source: 'auto' })
    expect(resolveFulltextDriverSelection({ BETA_URL: 'x', MEILISEARCH_HOST: 'y' }, factories)).toEqual({ id: 'meilisearch', source: 'auto', reason: 'ambiguous' })
    const withoutMeili = [factory('beta', 'BETA_URL'), factory('gamma', 'GAMMA_URL')]
    expect(resolveFulltextDriverSelection({ BETA_URL: 'x', GAMMA_URL: 'y' }, withoutMeili)).toEqual({ id: 'beta', source: 'auto', reason: 'ambiguous' })
  })
})
