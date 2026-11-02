import type { EntityManager } from '@mikro-orm/postgresql'
import {
  createPasswordHasher,
  setPasswordHasher,
  type Argon2Module,
  type PasswordHashAlgorithm,
} from '@open-mercato/shared/lib/auth/passwordHasher'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitSecurityEvent } from '../../events'
import { PasswordService } from '../PasswordService'

jest.mock('../../events', () => ({
  emitSecurityEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

type TestUser = {
  id: string
  passwordHash: string | null
  tenantId: string | null
  organizationId: string | null
  deletedAt: Date | null
}

const FAST_ARGON2ID_PARAMS = {
  memoryCost: 1024,
  timeCost: 1,
  parallelism: 1,
}

const testArgon2: Argon2Module = {
  async hash(password, options) {
    const digest = Buffer.from(password).toString('base64url')
    return `$argon2id$v=19$m=${options.memoryCost},t=${options.timeCost},p=${options.parallelism}$dGVzdC1zYWx0$${digest}`
  },
  async verify(hashed, password) {
    return hashed.endsWith(`$${Buffer.from(password).toString('base64url')}`)
  },
}

function createTestPasswordHasher(algorithm: PasswordHashAlgorithm) {
  return createPasswordHasher(
    {
      algorithm,
      bcryptCost: 4,
      argon2id: FAST_ARGON2ID_PARAMS,
    },
    {
      loadArgon2: async () => testArgon2,
    },
  )
}

function createUser(passwordHash: string | null): TestUser {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    passwordHash,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    deletedAt: null,
  }
}

function createService() {
  const emMock = {
    flush: jest.fn().mockResolvedValue(undefined),
  }
  const service = new PasswordService(emMock as unknown as EntityManager)
  return { service, emMock }
}

const mockedFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockedEmitSecurityEvent = emitSecurityEvent as jest.MockedFunction<typeof emitSecurityEvent>

describe('PasswordService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    setPasswordHasher(null)
  })

  test('validatePasswordPolicy returns violations for weak password', () => {
    const { service } = createService()
    const result = service.validatePasswordPolicy('abc')
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining(['minLength', 'digit', 'uppercase', 'special']))
  })

  test('verifyPassword returns false when user does not exist', async () => {
    const { service } = createService()
    mockedFindOneWithDecryption.mockResolvedValueOnce(null)
    const result = await service.verifyPassword('00000000-0000-4000-8000-000000000001', 'Password1!')
    expect(result).toBe(false)
  })

  test('verifyPassword returns false when user has no password hash', async () => {
    const { service } = createService()
    mockedFindOneWithDecryption.mockResolvedValueOnce(createUser(null) as never)
    const result = await service.verifyPassword('00000000-0000-4000-8000-000000000001', 'Password1!')
    expect(result).toBe(false)
  })

  test.each(['bcrypt', 'argon2id'] as const)(
    'verifyPassword accepts a %s current hash',
    async (currentHashAlgorithm) => {
      const currentPassword = 'CurrentPass1!'
      const currentPasswordHasher = createTestPasswordHasher(currentHashAlgorithm)
      const currentHash = await currentPasswordHasher.hash(currentPassword)
      const configuredAlgorithm = currentHashAlgorithm === 'bcrypt' ? 'argon2id' : 'bcrypt'
      setPasswordHasher(createTestPasswordHasher(configuredAlgorithm))
      const { service } = createService()
      const user = createUser(currentHash)
      mockedFindOneWithDecryption.mockResolvedValueOnce(user as never)

      await expect(service.verifyPassword(user.id, currentPassword)).resolves.toBe(true)
    },
  )

  test('changePassword writes Argon2id hash, flushes, and emits event', async () => {
    const { service, emMock } = createService()
    const currentPassword = 'CurrentPass1!'
    const newPassword = 'StrongPass2!'
    const currentHash = await createTestPasswordHasher('bcrypt').hash(currentPassword)
    const passwordHasher = createTestPasswordHasher('argon2id')
    setPasswordHasher(passwordHasher)
    const user = createUser(currentHash)
    mockedFindOneWithDecryption.mockResolvedValueOnce(user as never)

    await service.changePassword(user.id, currentPassword, newPassword)

    expect(emMock.flush).toHaveBeenCalledTimes(1)
    expect(user.passwordHash).toBeTruthy()
    expect(user.passwordHash).not.toBe(currentHash)
    expect(user.passwordHash).toMatch(/^\$argon2id\$/)
    expect(await passwordHasher.verify(newPassword, String(user.passwordHash))).toBe(true)
    expect(mockedEmitSecurityEvent).toHaveBeenCalledTimes(2)
    expect(mockedEmitSecurityEvent).toHaveBeenNthCalledWith(
      1,
      'security.password.changed',
      expect.objectContaining({
        userId: user.id,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        changedAt: expect.any(String),
      }),
    )
    expect(mockedEmitSecurityEvent).toHaveBeenNthCalledWith(
      2,
      'security.password.notification_requested',
      expect.objectContaining({
        userId: user.id,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        changedAt: expect.any(String),
      }),
    )
  })

  test('changePassword throws when current password is invalid', async () => {
    const { service } = createService()
    const passwordHasher = createTestPasswordHasher('bcrypt')
    setPasswordHasher(passwordHasher)
    const user = createUser(await passwordHasher.hash('CurrentPass1!'))
    mockedFindOneWithDecryption.mockResolvedValueOnce(user as never)

    await expect(service.changePassword(user.id, 'WrongPass1!', 'StrongPass2!')).rejects.toMatchObject({
      name: 'PasswordServiceError',
      statusCode: 401,
      message: 'Current password is invalid',
    })
  })

  test('changePassword throws when new password fails policy', async () => {
    const { service } = createService()
    const passwordHasher = createTestPasswordHasher('bcrypt')
    setPasswordHasher(passwordHasher)
    const user = createUser(await passwordHasher.hash('CurrentPass1!'))
    mockedFindOneWithDecryption.mockResolvedValueOnce(user as never)

    await expect(service.changePassword(user.id, 'CurrentPass1!', 'abc')).rejects.toMatchObject({
      name: 'PasswordServiceError',
      statusCode: 400,
      message: 'Password does not meet the requirements',
      errors: expect.arrayContaining(['minLength', 'digit', 'uppercase', 'special']),
    })
  })

  test('changePassword throws when new password matches current one', async () => {
    const { service } = createService()
    const currentPassword = 'CurrentPass1!'
    const currentPasswordHasher = createTestPasswordHasher('argon2id')
    const user = createUser(await currentPasswordHasher.hash(currentPassword))
    setPasswordHasher(createTestPasswordHasher('bcrypt'))
    mockedFindOneWithDecryption.mockResolvedValueOnce(user as never)

    await expect(service.changePassword(user.id, currentPassword, currentPassword)).rejects.toMatchObject({
      name: 'PasswordServiceError',
      statusCode: 400,
      message: 'New password must be different from current password',
    })
  })
})
