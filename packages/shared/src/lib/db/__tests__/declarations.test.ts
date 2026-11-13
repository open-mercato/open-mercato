import { registerDatabaseModuleDeclarations, resolveDeclaredDatabaseRequestContext, type DatabaseRequestInput } from '../declarations'

const tenantId = '22222222-2222-4222-8222-222222222222'
const input: DatabaseRequestInput = { pathname: '/custom/extension', headers: new Headers(), requireAuth: false, requireCustomerAuth: true }
const key = Symbol.for('@open-mercato/shared.databaseModuleDeclarations.v1')
afterEach(() => { delete (globalThis as Record<symbol, unknown>)[key] })

it('resolves an independently registered extension without module-specific knowledge', async () => {
  const resolve = jest.fn(async () => ({ context: { kind: 'tenant' as const, tenantId, source: 'portal' as const }, organization: { id: 'org', slug: 'live' } }))
  const validate = jest.fn(async () => true)
  registerDatabaseModuleDeclarations([
    { moduleId: 'extension', declarations: { requestProviders: [{ matches: (request) => request.requireCustomerAuth, resolve }] } },
    { moduleId: 'binding-owner', declarations: { bindingValidators: [validate] } },
  ])
  expect(await resolveDeclaredDatabaseRequestContext(input)).toMatchObject({ kind: 'tenant', tenantId })
  expect(validate).toHaveBeenCalledWith(expect.objectContaining({ organization: { id: 'org', slug: 'live' } }))
})
it('refuses ambiguous identity providers instead of falling back to registration order', async () => {
  const provider = { matches: () => true, resolve: async () => null }
  registerDatabaseModuleDeclarations(['first', 'second'].map((moduleId) => ({ moduleId, declarations: { requestProviders: [provider] } })))
  await expect(resolveDeclaredDatabaseRequestContext(input)).rejects.toThrow('Ambiguous')
})
it('does not promote a rejected binding or anonymous request to a tenant', async () => {
  expect(await resolveDeclaredDatabaseRequestContext(input)).toMatchObject({ kind: 'identity', tenantId: null })
  registerDatabaseModuleDeclarations([{ moduleId: 'extension', declarations: {
    requestProviders: [{ matches: () => true, resolve: async () => ({ context: { kind: 'tenant', tenantId, source: 'portal' } }) }],
    bindingValidators: [async () => false],
  } }])
  expect(await resolveDeclaredDatabaseRequestContext(input)).toMatchObject({ kind: 'identity', tenantId: null })
})
it('propagates resolver and binding outages rather than returning an anonymous success', async () => {
  registerDatabaseModuleDeclarations([{ moduleId: 'extension', declarations: {
    requestProviders: [{ matches: () => true, resolve: async () => { throw new Error('unavailable') } }],
  } }])
  await expect(resolveDeclaredDatabaseRequestContext(input)).rejects.toThrow('unavailable')
})

it('resolves persisted job scope and rejects missing, malformed or conflicting tenants', async () => {
  const { resolveDeclaredDatabaseJobContext } = await import('../declarations')
  const job = { queue: 'custom', workerIds: ['extension:work'], payload: { tenantId } }
  await expect(resolveDeclaredDatabaseJobContext(job)).resolves.toMatchObject({ kind: 'tenant', tenantId, source: 'worker' })
  await expect(resolveDeclaredDatabaseJobContext({ ...job, payload: {} })).rejects.toThrow('verified tenant UUID')
  await expect(resolveDeclaredDatabaseJobContext({ ...job, payload: { tenantId: 'raw-header' } })).rejects.toThrow('verified tenant UUID')
  await expect(resolveDeclaredDatabaseJobContext({ ...job, metadata: { tenantId: '11111111-1111-4111-8111-111111111111' } })).rejects.toThrow('Conflicting')
})

it('lets an owner resolve its persisted envelope without central module knowledge', async () => {
  const { resolveDeclaredDatabaseJobContext } = await import('../declarations')
  const provider = { matches: (job: { queue: string }) => job.queue === 'custom', resolve: async () => ({ kind: 'tenant' as const, tenantId, source: 'worker' as const }) }
  registerDatabaseModuleDeclarations([{ moduleId: 'extension', declarations: { jobProviders: [provider] } }])
  await expect(resolveDeclaredDatabaseJobContext({ queue: 'custom', workerIds: [], payload: { envelope: {} } })).resolves.toMatchObject({ kind: 'tenant', tenantId })
  registerDatabaseModuleDeclarations([{ moduleId: 'another', declarations: { jobProviders: [provider] } }])
  await expect(resolveDeclaredDatabaseJobContext({ queue: 'custom', workerIds: [], payload: {} })).rejects.toThrow('Ambiguous')
})


it('provisions owner-local storage in order and rejects duplicate providers before any side effects', async () => {
  const { provisionDeclaredDatabaseStorage } = await import('../declarations')
  const connection = { query: jest.fn(async () => undefined) }
  const descriptor = { kind: 'extension', schema: 'public', tables: ['extension_storage'], configuration: {} }
  const provision = jest.fn(async () => { await connection.query() })
  registerDatabaseModuleDeclarations([{ moduleId: 'extension', declarations: { storageProviders: [{ id: 'extension.storage', descriptor, provision }] } }])
  await provisionDeclaredDatabaseStorage(connection)
  expect(provision).toHaveBeenCalledWith(connection)
  registerDatabaseModuleDeclarations([{ moduleId: 'other', declarations: { storageProviders: [{ id: 'extension.storage', descriptor, provision }] } }])
  await expect(provisionDeclaredDatabaseStorage(connection)).rejects.toThrow('Ambiguous')
  expect(provision).toHaveBeenCalledTimes(1)
})

it('propagates storage provisioning failure before attempting later providers', async () => {
  const { provisionDeclaredDatabaseStorage } = await import('../declarations')
  const later = jest.fn(async () => undefined)
  const descriptor = { kind: 'extension', schema: 'public', tables: ['extension_storage'], configuration: {} }
  registerDatabaseModuleDeclarations([{ moduleId: 'extension', declarations: { storageProviders: [
    { id: 'extension.first', descriptor, provision: async () => { throw new Error('[internal] storage failed') } },
    { id: 'extension.second', descriptor, provision: later },
  ] } }])
  await expect(provisionDeclaredDatabaseStorage({ query: async () => undefined })).rejects.toThrow('storage failed')
  expect(later).not.toHaveBeenCalled()
})
