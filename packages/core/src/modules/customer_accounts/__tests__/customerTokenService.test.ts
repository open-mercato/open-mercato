import { CustomerTokenService } from '../services/customerTokenService'

jest.mock('@open-mercato/core/modules/customer_accounts/lib/tokenGenerator', () => ({
  generateSecureToken: () => 'raw-token',
  hashToken: (t: string) => `hashed-${t}`,
}))

describe('CustomerTokenService – atomic token consumption', () => {
  function createKnexChain(updateResult: number) {
    const chain = {
      where: jest.fn().mockReturnThis(),
      whereNull: jest.fn().mockReturnThis(),
      update: jest.fn().mockResolvedValue(updateResult),
    }
    return { chain, knexFn: jest.fn().mockReturnValue(chain) }
  }

  function createEm(overrides: {
    findOneResult?: unknown
    knexUpdateResult: number
  }) {
    const { chain, knexFn } = createKnexChain(overrides.knexUpdateResult)
    const em = {
      findOne: jest.fn().mockResolvedValue(overrides.findOneResult ?? null),
      getKnex: jest.fn().mockReturnValue(knexFn),
      flush: jest.fn(),
    } as any
    return { em, knexFn, chain }
  }

  describe('verifyEmailToken', () => {
    const validRecord = {
      id: 'ver-1',
      token: 'hashed-abc',
      purpose: 'email_verification',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      user: { id: 'user-1', tenantId: 'tenant-1' },
    }

    it('performs atomic UPDATE SET used_at WHERE used_at IS NULL', async () => {
      const { em, knexFn, chain } = createEm({ findOneResult: validRecord, knexUpdateResult: 1 })
      const service = new CustomerTokenService(em)

      const result = await service.verifyEmailToken('abc', 'email_verification')

      expect(knexFn).toHaveBeenCalledWith('customer_user_email_verifications')
      expect(chain.where).toHaveBeenCalledWith('id', 'ver-1')
      expect(chain.whereNull).toHaveBeenCalledWith('used_at')
      expect(chain.where).toHaveBeenCalledWith('expires_at', '>', expect.any(Date))
      expect(chain.update).toHaveBeenCalledWith({ used_at: expect.any(Date) })
      expect(result).toEqual({ userId: 'user-1', tenantId: 'tenant-1' })
    })

    it('returns null when atomic UPDATE affects 0 rows (concurrent race)', async () => {
      const { em } = createEm({ findOneResult: validRecord, knexUpdateResult: 0 })
      const service = new CustomerTokenService(em)

      const result = await service.verifyEmailToken('abc', 'email_verification')

      expect(result).toBeNull()
    })

    it('returns null when token is already used (usedAt set)', async () => {
      const usedRecord = { ...validRecord, usedAt: new Date() }
      const { em } = createEm({ findOneResult: usedRecord, knexUpdateResult: 0 })
      const service = new CustomerTokenService(em)

      const result = await service.verifyEmailToken('abc', 'email_verification')

      expect(result).toBeNull()
    })

    it('returns null when token is expired', async () => {
      const expiredRecord = { ...validRecord, expiresAt: new Date(Date.now() - 60000) }
      const { em } = createEm({ findOneResult: expiredRecord, knexUpdateResult: 0 })
      const service = new CustomerTokenService(em)

      const result = await service.verifyEmailToken('abc', 'email_verification')

      expect(result).toBeNull()
    })

    it('returns null when token is not found', async () => {
      const { em } = createEm({ findOneResult: null, knexUpdateResult: 0 })
      const service = new CustomerTokenService(em)

      const result = await service.verifyEmailToken('abc', 'email_verification')

      expect(result).toBeNull()
    })

    it('returns null when tenant does not match', async () => {
      const { em } = createEm({ findOneResult: validRecord, knexUpdateResult: 1 })
      const service = new CustomerTokenService(em)

      const result = await service.verifyEmailToken('abc', 'email_verification', 'other-tenant')

      expect(result).toBeNull()
    })
  })

  describe('verifyPasswordResetToken', () => {
    const validRecord = {
      id: 'rst-1',
      token: 'hashed-xyz',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      user: { id: 'user-2', tenantId: 'tenant-2' },
    }

    it('performs atomic UPDATE SET used_at WHERE used_at IS NULL', async () => {
      const { em, knexFn, chain } = createEm({ findOneResult: validRecord, knexUpdateResult: 1 })
      const service = new CustomerTokenService(em)

      const result = await service.verifyPasswordResetToken('xyz')

      expect(knexFn).toHaveBeenCalledWith('customer_user_password_resets')
      expect(chain.where).toHaveBeenCalledWith('id', 'rst-1')
      expect(chain.whereNull).toHaveBeenCalledWith('used_at')
      expect(chain.update).toHaveBeenCalledWith({ used_at: expect.any(Date) })
      expect(result).toEqual({ userId: 'user-2', tenantId: 'tenant-2' })
    })

    it('returns null when atomic UPDATE affects 0 rows (concurrent race)', async () => {
      const { em } = createEm({ findOneResult: validRecord, knexUpdateResult: 0 })
      const service = new CustomerTokenService(em)

      const result = await service.verifyPasswordResetToken('xyz')

      expect(result).toBeNull()
    })

    it('returns null when token is already used', async () => {
      const usedRecord = { ...validRecord, usedAt: new Date() }
      const { em } = createEm({ findOneResult: usedRecord, knexUpdateResult: 0 })
      const service = new CustomerTokenService(em)

      const result = await service.verifyPasswordResetToken('xyz')

      expect(result).toBeNull()
    })

    it('returns null when token is expired', async () => {
      const expiredRecord = { ...validRecord, expiresAt: new Date(Date.now() - 60000) }
      const { em } = createEm({ findOneResult: expiredRecord, knexUpdateResult: 0 })
      const service = new CustomerTokenService(em)

      const result = await service.verifyPasswordResetToken('xyz')

      expect(result).toBeNull()
    })
  })
})
