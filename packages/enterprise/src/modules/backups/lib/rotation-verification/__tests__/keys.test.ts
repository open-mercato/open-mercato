import { randomBytes } from 'node:crypto'
import type { KmsService } from '@open-mercato/shared/lib/encryption/kms'
import { pinRotationProviders } from '../keys'

function provider() {
  const state = { key: randomBytes(32).toString('base64'), healthy: true }
  const service: KmsService = {
    isHealthy: () => state.healthy,
    async getTenantDek(tenantId) { return { tenantId, key: state.key, fetchedAt: Date.now() } },
    async createTenantDek() { throw new Error('Must not provision keys') },
  }
  return { state, value: { identity: randomBytes(8).toString('hex'), service } }
}

test('pins actual keys and refuses undeclared scopes or provisioning', async () => {
  const source = provider(); const target = provider()
  const pinned = await pinRotationProviders(['tenant'], source.value, target.value)
  await expect(pinned.kms.getTenantDek('tenant')).resolves.toMatchObject({ key: target.state.key })
  await expect(pinned.kms.getTenantDek('other')).rejects.toThrow('COVERAGE_UNSUPPORTED')
  await expect(pinned.kms.createTenantDek('tenant')).rejects.toThrow('PROVISIONING_FORBIDDEN')
  target.state.key = randomBytes(32).toString('base64')
  await expect(pinned.refresh()).rejects.toThrow('KEY_CHANGED')
})

test('different provider handles cannot turn identical key material into a rotation', async () => {
  const source = provider(); const target = provider(); target.state.key = source.state.key
  await expect(pinRotationProviders(['tenant'], source.value, target.value)).rejects.toThrow('UNCHANGED_KEY')
})

test('does not accept unavailable providers or changed provider identity', async () => {
  const source = provider(); const target = provider()
  const pinned = await pinRotationProviders(['tenant'], source.value, target.value)
  target.value.identity = 'replacement'
  await expect(pinned.refresh()).rejects.toThrow('PROVIDER_CHANGED')
  target.state.healthy = false
  await expect(pinRotationProviders(['tenant'], source.value, target.value)).rejects.toThrow('KEY_UNAVAILABLE')
})


test('yields for cancellation before reading any provider key', async () => {
  const source = provider(); const target = provider(); const controller = new AbortController()
  const read = jest.spyOn(source.value.service, 'getTenantDek')
  setImmediate(() => controller.abort())
  await expect(pinRotationProviders(['tenant'], source.value, target.value, controller.signal)).rejects.toThrow('VERIFICATION_INCOMPLETE')
  expect(read).not.toHaveBeenCalled()
})
