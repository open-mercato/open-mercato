import { protectKeyRotation } from '../lib/rotation-protection'
import type { RotationProtectionContext } from '@open-mercato/shared/lib/encryption/rotationProtection'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
const context = { tenantId: 'tenant', organizationId: null, dryRun: false, previousKey: null } as RotationProtectionContext

describe('rotation protection preflight', () => {
  let error: jest.SpyInstance
  beforeEach(() => { error = jest.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => error.mockRestore())
  test.each([undefined, false, 'false', 'yes', '1'])('refuses absent/non-exact acknowledgment %s without mutation', async (acknowledgment) => {
    const operation = jest.fn()
    await expect(protectKeyRotation(context, acknowledgment, undefined, operation)).rejects.toThrow('acknowledgmentRequired')
    expect(operation).not.toHaveBeenCalled()
    expect(error.mock.calls[0][0]).toContain('ERROR:')
  })
  test.each([true, 'true'])('accepts exact acknowledgment and repeats warning', async (acknowledgment) => {
    const operation = jest.fn()
    await protectKeyRotation(context, acknowledgment, undefined, operation)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
    await expect(protectKeyRotation(context, undefined, undefined, operation)).rejects.toThrow()
  })
  test('read-only previews need no acknowledgment', async () => {
    const operation = jest.fn()
    await protectKeyRotation({ ...context, dryRun: true }, undefined, undefined, operation)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
  })
  test('protected service failure never downgrades even with acknowledgment', async () => {
    const operation = jest.fn()
    const service = { protect: jest.fn().mockRejectedValue(new Error('backup failed')) }
    await expect(protectKeyRotation(context, true, service, operation)).rejects.toThrow('backup failed')
    expect(operation).not.toHaveBeenCalled()
  })
  test('protected service wraps the real operation', async () => {
    const order: string[] = []
    await protectKeyRotation(context, undefined, { protect: async (_context, operation) => { order.push('backup'); await operation(); order.push('verify') } }, async () => { order.push('rotate') })
    expect(order).toEqual(['backup', 'rotate', 'verify'])
  })
  test('protected maintenance refuses an active outer transaction before calling the service',async()=>{
    const service={protect:jest.fn()};const operation=jest.fn()
    const entityManager={isInTransaction:()=>true} as RotationProtectionContext['entityManager']
    await expect(protectKeyRotation({...context,entityManager},undefined,service,operation)).rejects.toThrow('active transaction')
    expect(service.protect).not.toHaveBeenCalled();expect(operation).not.toHaveBeenCalled()
  })

})
