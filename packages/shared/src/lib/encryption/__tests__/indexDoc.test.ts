import { decryptIndexDocCustomFields, decryptIndexDocForSearch, encryptIndexDocForStorage } from '../indexDoc'
import { decryptCustomFieldValue } from '../customFieldValues'

jest.mock('../customFieldValues', () => ({
  decryptCustomFieldValue: jest.fn(async (value: unknown) => value),
}))

const decryptCustomFieldValueMock = decryptCustomFieldValue as jest.Mock

describe('encryption/indexDoc', () => {
  beforeEach(() => {
    decryptCustomFieldValueMock.mockReset()
    decryptCustomFieldValueMock.mockImplementation(async (value: unknown) => value)
  })

  test('decryptIndexDocCustomFields decrypts cf keys (including arrays)', async () => {
    decryptCustomFieldValueMock.mockImplementation(async (value: unknown) => {
      if (value === 'enc') return 'dec'
      if (value === 'enc2') return 'dec2'
      return value
    })

    const doc = {
      id: '1',
      title: 'Encrypted',
      'cf:secret': 'enc',
      'cf:tags': ['enc2', 'plain'],
      cf_secret: 'enc',
    }

    const out = await decryptIndexDocCustomFields(doc, { tenantId: 't1', organizationId: 'org1' }, {} as any)
    expect(out).toEqual({
      id: '1',
      title: 'Encrypted',
      'cf:secret': 'dec',
      'cf:tags': ['dec2', 'plain'],
      cf_secret: 'dec',
    })
    expect(decryptCustomFieldValueMock).toHaveBeenCalled()
  })

  test('decryptIndexDocForSearch merges decrypted entity payload and decrypts cf keys', async () => {
    decryptCustomFieldValueMock.mockImplementation(async (value: unknown) => (value === 'enc' ? 'dec' : value))

    const service = {
      isEnabled: () => true,
      decryptEntityPayload: jest.fn(async (_entityId: string, _payload: Record<string, unknown>) => ({
        title: 'Plain',
      })),
    }

    const out = await decryptIndexDocForSearch(
      'example:todo',
      { id: '1', title: 'Encrypted', 'cf:secret': 'enc' },
      { tenantId: 't1', organizationId: 'org1' },
      service as any,
    )

    expect(out.title).toBe('Plain')
    expect(out['cf:secret']).toBe('dec')
    expect(service.decryptEntityPayload).toHaveBeenCalledWith(
      'example:todo',
      expect.any(Object),
      't1',
      'org1',
    )
  })

  test('decryptIndexDocForSearch decrypts customer entity when indexing customer profiles', async () => {
    const service = {
      isEnabled: () => true,
      decryptEntityPayload: jest.fn(async (entityId: string) => (entityId === 'customers:customer_entity' ? { display_name: 'Plain' } : {})),
    }

    const out = await decryptIndexDocForSearch(
      'customers:customer_person_profile',
      { id: '1', display_name: 'Encrypted' },
      { tenantId: 't1', organizationId: 'org1' },
      service as any,
    )

    expect(out.display_name).toBe('Plain')
    expect(service.decryptEntityPayload).toHaveBeenCalledWith(
      'customers:customer_entity',
      expect.any(Object),
      't1',
      'org1',
    )
  })

  test('encryptIndexDocForStorage encrypts entity fields using the configured map', async () => {
    const service = {
      isEnabled: () => true,
      encryptEntityPayload: jest.fn(async (_entityId: string, payload: Record<string, unknown>) => ({
        ...payload,
        resultTitle: 'enc',
      })),
    }

    const out = await encryptIndexDocForStorage(
      'vector:vector_search',
      { resultTitle: 'plain' },
      { tenantId: 't1', organizationId: 'org1' },
      service as any,
    )

    expect(out.resultTitle).toBe('enc')
    expect(service.encryptEntityPayload).toHaveBeenCalledWith(
      'vector:vector_search',
      expect.any(Object),
      't1',
      'org1',
    )
  })
})
