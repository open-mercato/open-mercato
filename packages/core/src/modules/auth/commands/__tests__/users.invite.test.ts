jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    auth: { user: 'auth:user', role: 'auth:role' },
    directory: { organization: 'directory:organization' },
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/auth/emails/InviteUserEmail', () => ({
  __esModule: true,
  default: jest.fn(() => '<email />'),
}))

const mockFindOneWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn(async () => []),
}))

import '@open-mercato/core/modules/auth/commands/users'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { User } from '../../data/entities'

const mockSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>

const orgId = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0'
const tenantId = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0'

type CreateUserResult = { user: User; warning?: 'invite_email_failed' }

function buildTestContext() {
  const createdUser = {
    id: 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0',
    email: 'invited@example.com',
    emailHash: 'hash',
    passwordHash: null,
    isConfirmed: true,
    organizationId: orgId,
    tenantId,
    name: null,
  } as unknown as User

  const em: any = {
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    flush: jest.fn(async () => undefined),
    remove: jest.fn(function remove(this: any) { return this }),
    persist: jest.fn(function persist(this: any) { return this }),
    nativeDelete: jest.fn(async () => 0),
    fork: jest.fn(() => em),
  }

  const dataEngine = {
    createOrmEntity: jest.fn(async () => createdUser) as any,
    setCustomFields: jest.fn(async () => undefined) as DataEngine['setCustomFields'],
    emitOrmEntityEvent: (async () => undefined) as DataEngine['emitOrmEntityEvent'],
    markOrmEntityChange: jest.fn() as any,
    flushOrmEntityChanges: (async () => undefined) as DataEngine['flushOrmEntityChanges'],
  }

  const container = {
    resolve: (token: string) => {
      switch (token) {
        case 'dataEngine': return dataEngine
        case 'em': return em
        case 'rbacService': return { invalidateUserCache: jest.fn(async () => {}) }
        case 'cache': return { deleteByTags: jest.fn(async () => {}) }
        case 'notificationService': return { create: jest.fn(async () => ({})) }
        default: throw new Error(`Unexpected dependency: ${token}`)
      }
    },
  }

  const ctx: CommandRuntimeContext = {
    container: container as any,
    auth: { sub: 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0', tenantId, orgId } as any,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: undefined as any,
  }

  // First call: organization lookup returns the org; second call: duplicate email check returns null
  mockFindOneWithDecryption
    .mockResolvedValueOnce({ id: orgId, tenant: { id: tenantId } })
    .mockResolvedValueOnce(null)

  return { em, dataEngine, ctx }
}

describe('auth.user.create — invite flow', () => {
  const handler = commandRegistry.get<Record<string, unknown>, CreateUserResult>('auth.user.create') as CommandHandler<Record<string, unknown>, CreateUserResult>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('is registered in the command registry', () => {
    expect(handler).toBeDefined()
    expect(handler.id).toBe('auth.user.create')
  })

  it('creates user with null passwordHash when sendInviteEmail is true', async () => {
    const { dataEngine, ctx } = buildTestContext()

    const result = await handler.execute({
      email: 'invited@example.com',
      sendInviteEmail: true,
      organizationId: orgId,
    }, ctx) as CreateUserResult

    expect(result.user).toBeDefined()
    expect(result.user.passwordHash).toBeNull()
    expect(dataEngine.createOrmEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ passwordHash: null }),
      }),
    )
  })

  it('creates a PasswordReset token and sends email', async () => {
    const { em, ctx } = buildTestContext()

    await handler.execute({
      email: 'invited@example.com',
      sendInviteEmail: true,
      organizationId: orgId,
    }, ctx)

    expect(em.create).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('returns warning when sendEmail throws', async () => {
    const { ctx } = buildTestContext()
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP down'))

    const result = await handler.execute({
      email: 'invited@example.com',
      sendInviteEmail: true,
      organizationId: orgId,
    }, ctx) as CreateUserResult

    expect(result.user).toBeDefined()
    expect(result.warning).toBe('invite_email_failed')
  })

  it('does not return warning when email succeeds', async () => {
    const { ctx } = buildTestContext()

    const result = await handler.execute({
      email: 'invited@example.com',
      sendInviteEmail: true,
      organizationId: orgId,
    }, ctx) as CreateUserResult

    expect(result.warning).toBeUndefined()
  })
})
