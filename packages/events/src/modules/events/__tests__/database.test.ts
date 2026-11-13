import { registerDatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
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


const input = (payload: unknown, metadata?: Record<string, unknown>) => ({ queue: 'events', workerIds: ['events'], payload, metadata })

it('uses canonical persisted options rather than domain payload tenant flags', async () => {
  await expect(provider.resolve(input({ event: 'test.created', options: { tenantId }, payload: { maintenance: true, tenantId: 'untrusted' } }))).resolves.toMatchObject({ kind: 'tenant', tenantId })
  await expect(provider.resolve(input({ event: 'test.created', options: { tenantId } }, { tenantId: 'other' }))).rejects.toThrow('Conflicting')
})

it('delegates a nested global event only to its exact owner classifier', async () => {
  const resolve = jest.fn(async () => ({ kind: 'maintenance' as const, tenantId: null, source: 'maintenance' as const, operation: 'owner-global' }))
  registerDatabaseModuleDeclarations([{ moduleId: 'event-test-owner', declarations: { jobProviders: [{ matches: ({ queue }) => queue === 'event:test.global', resolve }] } }])
  const payload = { retained: true }
  await expect(provider.resolve(input({ event: 'test.global', options: { tenantId: null }, payload }))).resolves.toMatchObject({ kind: 'maintenance' })
  expect(resolve).toHaveBeenCalledWith({ queue: 'event:test.global', workerIds: [], payload, metadata: undefined })
})

it('fails closed for unknown global events even with payload privilege or tenant flags', async () => {
  await expect(provider.resolve(input({ event: 'test.unknown', options: {}, payload: { maintenance: true } }))).rejects.toThrow('tenant UUID')
  await expect(provider.resolve(input({ event: 'test.unknown', options: {}, payload: { tenantId } }))).rejects.toThrow('explicit maintenance classifier')
  await expect(provider.resolve(input({ event: 'test.unknown', options: null }))).rejects.toThrow('verified options')
  await expect(provider.resolve(input({ event: '', options: {} }))).rejects.toThrow('Invalid persisted')
})
