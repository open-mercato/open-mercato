import { bindEncryptionServiceToRequest } from '../request-encryption'

describe('bindEncryptionServiceToRequest', () => {
  const requestEm = { id: 'request-em' }

  function createService() {
    return {
      decryptEntityPayload: jest.fn(async (_entityId: string, payload: Record<string, unknown>) => payload),
      isEnabled: jest.fn(function isEnabled(this: { marker?: string }) { return this.marker === 'service' }),
      marker: 'service',
    }
  }

  it('decrypts with the request EntityManager when the caller passes none', async () => {
    const service = createService()
    const bound = bindEncryptionServiceToRequest(service, requestEm as never)

    await bound?.decryptEntityPayload('auth:user', { id: 'u1' }, 't1', 'o1')

    expect(service.decryptEntityPayload).toHaveBeenCalledWith('auth:user', { id: 'u1' }, 't1', 'o1', { em: requestEm })
  })

  it('keeps an explicitly passed EntityManager', async () => {
    const service = createService()
    const bound = bindEncryptionServiceToRequest(service, requestEm as never)
    const transactionalEm = { id: 'tx-em' }

    await bound?.decryptEntityPayload('auth:user', { id: 'u1' }, 't1', null, { em: transactionalEm as never })

    expect(service.decryptEntityPayload).toHaveBeenCalledWith('auth:user', { id: 'u1' }, 't1', null, { em: transactionalEm })
  })

  it('delegates other members bound to the original service', () => {
    const service = createService()
    const bound = bindEncryptionServiceToRequest(service, requestEm as never)

    expect(bound?.isEnabled()).toBe(true)
    expect(bindEncryptionServiceToRequest(null, requestEm as never)).toBeNull()
  })
})
