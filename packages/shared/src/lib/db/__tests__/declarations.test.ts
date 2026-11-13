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
