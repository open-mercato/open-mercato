import { CustomerTokenService } from '../services/customerTokenService'

jest.mock('@open-mercato/core/modules/customer_accounts/lib/tokenGenerator', () => ({
  generateSecureToken: () => 'raw-token',
  hashToken: (t: string) => `hashed-${t}`,
}))

describe('CustomerTokenService – atomic token consumption', () => {
  function createKyselyChain(updateResult: number) {
    const builder = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      executeTakeFirst: jest
        .fn()
        .mockResolvedValue({ numUpdatedRows: BigInt(updateResult) }),
    }
    const db = { updateTable: jest.fn().mockReturnValue(builder) }
    return { builder, db }
  }

  function createEm(overrides: {
    findOneResult?: unknown
    knexUpdateResult: number
  }) {
    const { builder, db } = createKyselyChain(overrides.knexUpdateResult)
    const em = {
      findOne: jest.fn().mockResolvedValue(overrides.findOneResult ?? null),
      getKysely: jest.fn().mockReturnValue(db),
      flush: jest.fn(),
    } as any
    return { em, db, builder }
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
      const { em, db, builder } = createEm({ findOneResult: validRecord, knexUpdateResult: 1 })
      const service = new CustomerTokenService(em)

      const result = await service.verifyEmailToken('abc', 'email_verification')

      expect(db.updateTable).toHaveBeenCalledWith('customer_user_email_verifications')
      expect(builder.set).toHaveBeenCalledWith({ used_at: expect.any(Date) })
      expect(builder.where).toHaveBeenCalledWith('id', '=', 'ver-1')
      expect(builder.where).toHaveBeenCalledWith('used_at', 'is', null)
      expect(builder.where).toHaveBeenCalledWith('expires_at', '>', expect.any(Date))
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
      const { em, db, builder } = createEm({ findOneResult: validRecord, knexUpdateResult: 1 })
      const service = new CustomerTokenService(em)

      const result = await service.verifyPasswordResetToken('xyz')

      expect(db.updateTable).toHaveBeenCalledWith('customer_user_password_resets')
      expect(builder.set).toHaveBeenCalledWith({ used_at: expect.any(Date) })
      expect(builder.where).toHaveBeenCalledWith('id', '=', 'rst-1')
      expect(builder.where).toHaveBeenCalledWith('used_at', 'is', null)
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
