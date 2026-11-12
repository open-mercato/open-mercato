import { NextResponse } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { UserAcl, RoleAcl } from '@open-mercato/core/modules/auth/data/entities'
import { resolveSecurityUsersContext } from '../_shared'
import { requireSudo } from '../../../lib/sudo-middleware'
import { GET } from '../[id]/mfa/status/route'
import { POST } from '../[id]/mfa/reset/route'
import '../../../commands/resetUserMfa'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback: string) => fallback })),
}))
jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => ({
  resolveIsSuperAdmin: jest.fn(async ({ container }) => container.resolve('rbacService').isSuperAdmin),
}))
jest.mock('../_shared', () => ({
  resolveSecurityUsersContext: jest.fn(),
  assertActorCanAccessSecurityUserTarget: jest.fn(async () => undefined),
  mapSecurityUsersError: jest.fn(async (error: CrudHttpError) =>
    NextResponse.json(error.body, { status: error.status })),
}))
jest.mock('../../../lib/sudo-middleware', () => ({
  requireSudo: jest.fn(async () => undefined),
}))

const targetUserId = '11111111-1111-4111-8111-111111111111'
const actorUserId = '22222222-2222-4222-8222-222222222222'
const mockedResolveContext = jest.mocked(resolveSecurityUsersContext)

function setup(actorIsSuperAdmin: boolean, targetGrant: 'direct' | 'role' | 'ordinary') {
  const em = {
    findOne: jest.fn(async (entity: unknown) =>
      (entity === UserAcl && targetGrant === 'direct') || (entity === RoleAcl && targetGrant === 'role')
        ? { isSuperAdmin: true }
        : null),
  }
  const rbacService = {
    isSuperAdmin: actorIsSuperAdmin,
    loadAclWithEntityManager: jest.fn(async () => ({ isSuperAdmin: actorIsSuperAdmin })),
  }
  const getUserMfaStatus = jest.fn(async () => ({
    enrolled: true, methods: [], recoveryCodesRemaining: 3, compliant: true,
  }))
  const resetUserMfa = jest.fn(async () => undefined)
  const execute = jest.fn(async () => ({ result: { ok: true } }))
  const dependencies = { em, rbacService, mfaAdminService: { getUserMfaStatus, resetUserMfa }, commandBus: { execute } }
  const container = {
    resolve: (name: string) => dependencies[name as keyof typeof dependencies],
  }
  const auth = { sub: actorUserId, tenantId: 'tenant-1', orgId: 'org-1' }
  const commandContext = { auth, container }
  mockedResolveContext.mockResolvedValue({
    auth, container, commandContext, mfaAdminService: dependencies.mfaAdminService,
  } as never)
  jest.mocked(findOneWithDecryption).mockResolvedValue({ id: targetUserId, tenantId: 'tenant-1' } as never)
  jest.mocked(findWithDecryption).mockResolvedValue(targetGrant === 'role' ? [{ role: { id: 'role-1' } }] as never : [])
  return { commandContext, getUserMfaStatus, resetUserMfa, execute, em, rbacService }
}

function request(method: 'GET' | 'POST') {
  return new Request('https://example.test/api/security/users/' + targetUserId + '/mfa/' + (method === 'GET' ? 'status' : 'reset'), {
    method,
    ...(method === 'POST' ? {
      headers: { 'content-type': 'application/json', 'x-sudo-token': 'valid-sudo-token' },
      body: JSON.stringify({ reason: 'security incident' }),
    } : {}),
  })
}

describe('issue 9150: effective superadmin protection at MFA entrypoints', () => {
  beforeEach(() => jest.clearAllMocks())

  test.each([
    ['direct', 'status'],
    ['direct', 'reset'],
    ['direct', 'command'],
    ['role', 'status'],
    ['role', 'reset'],
    ['role', 'command'],
  ] as const)('denies tenant admin for %s superadmin target through %s', async (grant, entrypoint) => {
    const context = setup(false, grant)
    const params = { params: Promise.resolve({ id: targetUserId }) }

    if (entrypoint === 'status') {
      expect((await GET(request('GET'), params)).status).toBe(403)
    } else if (entrypoint === 'reset') {
      expect((await POST(request('POST'), params)).status).toBe(403)
    } else {
      await expect(commandRegistry.get('security.admin.mfa.reset')!.execute(
        { userId: targetUserId, reason: 'security incident' }, context.commandContext as never,
      )).rejects.toMatchObject({ status: 403 })
    }

    expect(context.getUserMfaStatus).not.toHaveBeenCalled()
    expect(context.resetUserMfa).not.toHaveBeenCalled()
    expect(context.execute).not.toHaveBeenCalled()
    expect(requireSudo).not.toHaveBeenCalled()
    expect(context.rbacService.loadAclWithEntityManager).toHaveBeenCalledWith(
      context.em, actorUserId, { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  test.each([
    [false, 'ordinary'],
    [true, 'direct'],
    [true, 'role'],
  ] as const)('allows authorized operations: actor superadmin=%s, target=%s', async (actorIsSuperAdmin, grant) => {
    const context = setup(actorIsSuperAdmin, grant)
    const params = { params: Promise.resolve({ id: targetUserId }) }

    expect((await GET(request('GET'), params)).status).toBe(200)
    expect((await POST(request('POST'), params)).status).toBe(200)
    await expect(commandRegistry.get('security.admin.mfa.reset')!.execute(
      { userId: targetUserId, reason: 'security incident' }, context.commandContext as never,
    )).resolves.toEqual({ ok: true })
    expect(requireSudo).toHaveBeenCalled()
    expect(context.getUserMfaStatus).toHaveBeenCalledWith(targetUserId, {
      tenantId: 'tenant-1', isSuperAdmin: actorIsSuperAdmin,
    })
    expect(context.resetUserMfa).toHaveBeenCalledWith(actorUserId, targetUserId, 'security incident', {
      tenantId: 'tenant-1', organizationId: 'org-1', isSuperAdmin: actorIsSuperAdmin,
    })
  })
})
