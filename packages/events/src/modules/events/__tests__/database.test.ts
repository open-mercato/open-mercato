import { databaseDeclarations } from '../database'

const tenantId = '22222222-2222-4222-8222-222222222222'
const provider = databaseDeclarations.jobProviders![0]
const job = { queue: 'events', workerIds: [], payload: { event: 'extension.record.created', payload: { tenantId: 'untrusted' }, options: { tenantId } } }

test('uses persisted event options rather than nested payload identity', async () => {
  expect(provider.matches(job)).toBe(true)
  expect(provider.matches({ ...job, queue: 'other' })).toBe(false)
  await expect(provider.resolve(job)).resolves.toMatchObject({ kind: 'tenant', tenantId, operation: 'extension.record.created' })
})

test('fails closed before dispatch on malformed or contradictory envelopes', async () => {
  for (const payload of [null, {}, { event: '', options: { tenantId } }, { event: 'extension.record.created', options: {} }]) {
    await expect(provider.resolve({ ...job, payload })).rejects.toThrow()
  }
  await expect(provider.resolve({ ...job, metadata: { tenantId: '11111111-1111-4111-8111-111111111111' } })).rejects.toThrow('Conflicting')
})
