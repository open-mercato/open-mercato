import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import unlinkOnPersonDelete, { metadata as personMeta } from '@open-mercato/core/modules/customer_accounts/subscribers/unlinkOnPersonDelete'
import unlinkOnCompanyDelete, { metadata as companyMeta } from '@open-mercato/core/modules/customer_accounts/subscribers/unlinkOnCompanyDelete'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const mockLogger = jest.requireMock('@open-mercato/shared/lib/logger').createLogger('test') as {
  debug: jest.Mock
  info: jest.Mock
  warn: jest.Mock
  error: jest.Mock
}


type NativeUpdateCall = { entity: unknown; where: Record<string, unknown>; data: Record<string, unknown> }

function makeEm() {
  const calls: NativeUpdateCall[] = []
  const em = {
    nativeUpdate: async (entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      calls.push({ entity, where, data })
      return 1
    },
  }
  return { em, calls }
}

function makeCtx(em: unknown) {
  return { resolve: <T = unknown>(name: string): T => (name === 'em' ? (em as T) : (undefined as unknown as T)) }
}

describe('customer_accounts unlink subscribers on CRM delete', () => {
  test('person subscriber wires to customers.person.deleted', () => {
    expect(personMeta.event).toBe('customers.person.deleted')
    expect(personMeta.persistent).toBe(true)
    expect(personMeta.id).toBe('customer_accounts:unlink-on-person-delete')
  })

  test('company subscriber wires to customers.company.deleted', () => {
    expect(companyMeta.event).toBe('customers.company.deleted')
    expect(companyMeta.persistent).toBe(true)
    expect(companyMeta.id).toBe('customer_accounts:unlink-on-company-delete')
  })

  test('person delete nullifies personEntityId on matching customer users scoped by tenant', async () => {
    const { em, calls } = makeEm()
    const entityId = '00000000-0000-0000-0000-000000000001'
    const tenantId = '00000000-0000-0000-0000-000000000002'
    await unlinkOnPersonDelete({ entityId, id: 'some-profile-id', tenantId }, makeCtx(em))

    expect(calls).toHaveLength(1)
    expect(calls[0].entity).toBe(CustomerUser)
    expect(calls[0].where).toEqual({ personEntityId: entityId, tenantId })
    expect(calls[0].data.personEntityId).toBeNull()
    expect(calls[0].data.updatedAt).toBeInstanceOf(Date)
  })

  test('person delete falls back to payload.id when entityId is missing (backward compatibility)', async () => {
    const { em, calls } = makeEm()
    const legacyId = '00000000-0000-0000-0000-000000000003'
    await unlinkOnPersonDelete({ id: legacyId, tenantId: 'tenant-1' }, makeCtx(em))
    expect(calls[0].where).toEqual({ personEntityId: legacyId, tenantId: 'tenant-1' })
  })

  test('person delete is a no-op when entityId or tenantId is missing', async () => {
    const { em, calls } = makeEm()
    await unlinkOnPersonDelete({ tenantId: 'tenant-1' }, makeCtx(em))
    await unlinkOnPersonDelete({ entityId: 'id-1' }, makeCtx(em))
    await unlinkOnPersonDelete(null, makeCtx(em))
    expect(calls).toHaveLength(0)
  })

  test('company delete nullifies customerEntityId on matching customer users', async () => {
    const { em, calls } = makeEm()
    const entityId = '00000000-0000-0000-0000-000000000010'
    const tenantId = '00000000-0000-0000-0000-000000000020'
    await unlinkOnCompanyDelete({ entityId, id: 'company-profile-id', tenantId }, makeCtx(em))

    expect(calls).toHaveLength(1)
    expect(calls[0].entity).toBe(CustomerUser)
    expect(calls[0].where).toEqual({ customerEntityId: entityId, tenantId })
    expect(calls[0].data.customerEntityId).toBeNull()
    expect(calls[0].data.updatedAt).toBeInstanceOf(Date)
  })

  test('swallows errors so a failing unlink does not break the event bus', async () => {
    const errorEm = {
      nativeUpdate: async () => {
        throw new Error('db down')
      },
    }
    mockLogger.error.mockClear()
    const errorSpy = mockLogger.error
    await expect(
      unlinkOnPersonDelete({ entityId: 'id', tenantId: 't' }, makeCtx(errorEm)),
    ).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
