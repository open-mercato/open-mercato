import type { EntityManager } from '@mikro-orm/postgresql'
import { compare, hash } from 'bcryptjs'
import { PasswordReset, Session } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitSecurityEvent } from '../../events'
import { PasswordService } from '../PasswordService'

jest.mock('bcryptjs', () => ({
  compare: jest.fn(async (value: string, hashed: string | null) => hashed === `hashed:${value}`),
  hash: jest.fn(async (value: string) => `hashed:${value}`),
}))

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
    nativeDelete: jest.fn().mockResolvedValue(2),
    nativeUpdate: jest.fn().mockResolvedValue(2),
  }
  const rootEm = {
    ...emMock,
    transactional: jest.fn(async (work: (em: EntityManager) => Promise<unknown>) => work(emMock as unknown as EntityManager)),
  }
  const service = new PasswordService(rootEm as unknown as EntityManager)
  return { service, emMock, rootEm }
}

const mockedFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockedEmitSecurityEvent = emitSecurityEvent as jest.MockedFunction<typeof emitSecurityEvent>

describe('PasswordService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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

  test('changePassword updates hash, flushes, and emits event', async () => {
    const { service, emMock } = createService()
    const currentPassword = 'CurrentPass1!'
    const newPassword = 'StrongPass2!'
    const currentHash = await hash(currentPassword, 10)
    const user = createUser(currentHash)
    mockedFindOneWithDecryption.mockResolvedValueOnce(user as never)

    await service.changePassword(user.id, currentPassword, newPassword)

    expect(emMock.flush).toHaveBeenCalledTimes(1)
    expect(user.passwordHash).toBeTruthy()
    expect(user.passwordHash).not.toBe(currentHash)
    expect(await compare(newPassword, String(user.passwordHash))).toBe(true)
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
    const user = createUser(await hash('CurrentPass1!', 10))
    mockedFindOneWithDecryption.mockResolvedValueOnce(user as never)

    await expect(service.changePassword(user.id, 'WrongPass1!', 'StrongPass2!')).rejects.toMatchObject({
      name: 'PasswordServiceError',
      statusCode: 401,
      message: 'Current password is invalid',
    })
  })

  test('changePassword throws when new password fails policy', async () => {
    const { service } = createService()
    const user = createUser(await hash('CurrentPass1!', 10))
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
    const user = createUser(await hash(currentPassword, 10))
    mockedFindOneWithDecryption.mockResolvedValueOnce(user as never)

    await expect(service.changePassword(user.id, currentPassword, currentPassword)).rejects.toMatchObject({
      name: 'PasswordServiceError',
      statusCode: 400,
      message: 'New password must be different from current password',
    })
  })
  test('revokes every other session and consumes all unused resets in the password transaction', async () => {
    const { service, emMock, rootEm } = createService()
    const user = createUser('hashed:CurrentPass1!')
    mockedFindOneWithDecryption.mockResolvedValueOnce(user as never)

    await service.changePassword(user.id, 'CurrentPass1!', 'StrongPass2!', 'caller-session')

    expect(rootEm.transactional).toHaveBeenCalledTimes(1)
    expect(mockedFindOneWithDecryption).toHaveBeenCalledWith(
      emMock, expect.anything(), { id: user.id, deletedAt: null },
      expect.objectContaining({ refresh: true, lockMode: expect.anything() }), {},
    )
    expect(emMock.nativeDelete).toHaveBeenCalledWith(Session, { user: user.id, id: { $ne: 'caller-session' } })
    expect(emMock.nativeUpdate).toHaveBeenCalledWith(
      PasswordReset, { user: user.id, usedAt: null }, { usedAt: expect.any(Date) },
    )
    expect(mockedEmitSecurityEvent.mock.invocationCallOrder[0]).toBeGreaterThan(emMock.flush.mock.invocationCallOrder[0])
  })

  test.each([undefined, null])('revokes all sessions without a caller binding (%s)', async (sessionId) => {
    const { service, emMock } = createService()
    const user = createUser('hashed:CurrentPass1!')
    mockedFindOneWithDecryption.mockResolvedValueOnce(user as never)

    await service.changePassword(user.id, 'CurrentPass1!', 'StrongPass2!', sessionId)

    expect(emMock.nativeDelete).toHaveBeenCalledWith(Session, { user: user.id })
  })

  test('invalid credentials leave sessions and reset tokens untouched', async () => {
    const { service, emMock } = createService()
    const user = createUser('hashed:CurrentPass1!')
    mockedFindOneWithDecryption.mockResolvedValueOnce(user as never)

    await expect(service.changePassword(user.id, 'WrongPass1!', 'StrongPass2!', 'caller')).rejects.toMatchObject({ statusCode: 401 })

    expect(emMock.nativeDelete).not.toHaveBeenCalled()
    expect(emMock.nativeUpdate).not.toHaveBeenCalled()
    expect(emMock.flush).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
    expect(user.passwordHash).toBe('hashed:CurrentPass1!')
  })

  test.each(['nativeDelete', 'nativeUpdate', 'flush'] as const)('propagates %s failure without success events', async (method) => {
    const { service, emMock } = createService()
    const user = createUser('hashed:CurrentPass1!')
    mockedFindOneWithDecryption.mockResolvedValueOnce(user as never)
    emMock[method].mockRejectedValueOnce(new Error('[internal] database failure'))

    await expect(service.changePassword(user.id, 'CurrentPass1!', 'StrongPass2!', 'caller')).rejects.toThrow('database failure')

    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
  })

  test('does not emit success events when committing the transaction fails', async () => {
    const { service, rootEm } = createService()
    rootEm.transactional.mockRejectedValueOnce(new Error('[internal] commit failed'))

    await expect(service.changePassword('user', 'CurrentPass1!', 'StrongPass2!', 'caller')).rejects.toThrow('commit failed')

    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
  })

})
