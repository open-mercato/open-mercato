// Unit test: the bootstrap once-guard caches process-scoped services on
// globalThis and replays them on subsequent containers without re-running
// the dynamic import. registerDiRegistrars clears the cache so HMR sees
// fresh subscribers.

import { resetBootstrapCache } from '@open-mercato/shared/lib/di/container'

describe('bootstrap once-guard cache', () => {
  beforeEach(() => {
    resetBootstrapCache()
  })

  it('resetBootstrapCache clears the process-scoped bootstrap cache and encryption flag', () => {
    const g = globalThis as any
    g.__openMercatoBootstrapCache__ = { cache: { tag: 'memo' } }
    g.__openMercatoEncryptionEnabledCache__ = true
    resetBootstrapCache()
    expect(g.__openMercatoBootstrapCache__).toBeNull()
    expect(g.__openMercatoEncryptionEnabledCache__).toBeUndefined()
  })
})
