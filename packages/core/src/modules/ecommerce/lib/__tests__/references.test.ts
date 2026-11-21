import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { assertDomainMappingInScope } from '../references'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999'
const MAPPING_ID = '33333333-3333-4333-8333-333333333333'

const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }
const translate = (_key: string, fallback?: string) => fallback ?? ''

function containerWith(services: Record<string, unknown>): CrudCtx['container'] {
  return {
    hasRegistration: (name: string) => name in services,
    resolve: (name: string) => {
      if (!(name in services)) throw new Error(`[internal] Could not resolve '${name}'`)
      return services[name]
    },
  } as unknown as CrudCtx['container']
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (caught: unknown) => caught,
  )
}

function expectDomainMappingFieldError(error: unknown): void {
  expect(error).toBeInstanceOf(CrudHttpError)
  expect((error as CrudHttpError).status).toBe(400)
  expect((error as CrudHttpError).body).toMatchObject({
    fieldErrors: { domainMappingId: 'The selected domain does not belong to this organization.' },
  })
}

describe('assertDomainMappingInScope', () => {
  it('accepts a mapping owned by the organization', async () => {
    const findById = jest.fn(async () => ({ tenantId: TENANT_ID, organizationId: ORG_ID }))
    const container = containerWith({ domainMappingService: { findById } })

    await expect(assertDomainMappingInScope(container, MAPPING_ID, scope, translate)).resolves.toBeUndefined()
    expect(findById).toHaveBeenCalledWith(MAPPING_ID, { tenantId: TENANT_ID })
  })

  it('rejects a mapping owned by another organization with the domainMappingId field error', async () => {
    const findById = jest.fn(async () => ({ tenantId: TENANT_ID, organizationId: OTHER_ORG_ID }))
    const container = containerWith({ domainMappingService: { findById } })

    expectDomainMappingFieldError(await captureError(assertDomainMappingInScope(container, MAPPING_ID, scope, translate)))
  })

  it('answers the domainMappingId field error when the customer_accounts module is absent', async () => {
    const container = containerWith({})
    const resolve = jest.spyOn(container, 'resolve')

    expectDomainMappingFieldError(await captureError(assertDomainMappingInScope(container, MAPPING_ID, scope, translate)))
    expect(resolve).not.toHaveBeenCalled()
  })

  it('propagates resolution failures for a registered domainMappingService', async () => {
    const failure = new Error('Domain mapping dependency failed')
    const container = containerWith({ domainMappingService: {} })
    jest.spyOn(container, 'resolve').mockImplementation(() => { throw failure })

    await expect(assertDomainMappingInScope(container, MAPPING_ID, scope, translate)).rejects.toBe(failure)
  })
})
