import {
  clearPhoneCallProviders,
  getPhoneCallProvider,
  listPhoneCallProviders,
  registerPhoneCallProvider,
  type PhoneCallProviderAdapter,
} from '../provider'

function adapter(providerKey: string, displayName: string): PhoneCallProviderAdapter {
  return {
    providerKey,
    displayName,
    validateConnection: async () => ({ ok: true }),
    fetchCalls: async () => ({ calls: [], hasMore: false, nextCursor: null }),
  }
}

describe('phone call provider registration', () => {
  beforeEach(() => {
    clearPhoneCallProviders()
  })

  it('resolves a registered adapter by its provider key', () => {
    const tillio = adapter('tillio', 'Tillio')
    registerPhoneCallProvider(tillio)

    expect(getPhoneCallProvider('tillio')).toBe(tillio)
    expect(getPhoneCallProvider('absent')).toBeUndefined()
  })

  it('keeps one entry per provider key when a second adapter claims it', () => {
    registerPhoneCallProvider(adapter('tillio', 'Tillio'))
    const replacement = adapter('tillio', 'Tillio v2')
    registerPhoneCallProvider(replacement)

    expect(getPhoneCallProvider('tillio')).toBe(replacement)
    expect(listPhoneCallProviders()).toHaveLength(1)
  })

  it('lists adapters by display name rather than registration order', () => {
    registerPhoneCallProvider(adapter('zeta', 'Zeta Telecom'))
    registerPhoneCallProvider(adapter('alpha', 'Alpha Voice'))

    expect(listPhoneCallProviders().map((entry) => entry.providerKey)).toEqual(['alpha', 'zeta'])
  })

  it('removes the adapter when its own disposer runs', () => {
    const dispose = registerPhoneCallProvider(adapter('tillio', 'Tillio'))
    dispose()

    expect(getPhoneCallProvider('tillio')).toBeUndefined()
    expect(listPhoneCallProviders()).toEqual([])
  })

  // A later registration takes the key from under the earlier disposer, which the caller
  // may still hold. Deleting by key alone would let it unregister the adapter that
  // replaced it.
  it('ignores a disposer whose adapter was already replaced', () => {
    const disposeFirst = registerPhoneCallProvider(adapter('tillio', 'Tillio'))
    const replacement = adapter('tillio', 'Tillio v2')
    registerPhoneCallProvider(replacement)

    disposeFirst()

    expect(getPhoneCallProvider('tillio')).toBe(replacement)
  })
})
