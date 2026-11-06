import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'

const mockFindOne = jest.fn()
const mockEmit = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOne(...args),
}))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: (...args: unknown[]) => mockEmit(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const requestId = '33333333-3333-4333-8333-333333333333'
const actorId = '44444444-4444-4444-8444-444444444444'
const mockPermission = jest.fn()
const mockFlush = jest.fn()
const mockResolve = jest.fn()
const em = {
  fork: jest.fn().mockReturnThis(),
  flush: mockFlush,
  persist: jest.fn(),
  create: jest.fn((_entity, data: Record<string, unknown>) => data),
  find: jest.fn().mockResolvedValue([]),
  transactional: jest.fn(async (callback: (trx: unknown) => Promise<void>) => callback(em)),
}

function context(auth: CommandRuntimeContext['auth'] = { sub: actorId, tenantId, orgId: organizationId }): CommandRuntimeContext {
  return {
    auth,
    container: { resolve: mockResolve } as unknown as CommandRuntimeContext['container'],
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPermission.mockResolvedValue(false)
  mockFindOne.mockResolvedValue(null)
  mockResolve.mockImplementation((token: string) => {
    if (token === 'rbacService') return { userHasAllFeatures: mockPermission }
    if (token === 'em') return em
    return null
  })
})

for (const decision of ['accept', 'reject']) {
  describe(`staff.leave-requests.${decision} authorization`, () => {
    async function execute(ctx = context(), extra: Record<string, unknown> = {}) {
      const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
      await import('../leave-requests')
      const command = commandRegistry.get(`staff.leave-requests.${decision}`)
      if (!command) throw new Error('Command not registered')
      return command.execute({ id: requestId, ...extra }, ctx)
    }

    it('denies an ordinary message recipient before reading or mutating business state', async () => {
      await expect(execute(context(), { decidedByUserId: actorId, features: ['*'], tenantId, organizationId }))
        .rejects.toMatchObject({ status: 403 })
      expect(mockPermission).toHaveBeenCalledWith(actorId, ['staff.leave_requests.manage'], { tenantId, organizationId })
      expect(mockFindOne).not.toHaveBeenCalled()
      expect(mockFlush).not.toHaveBeenCalled()
      expect(mockEmit).not.toHaveBeenCalled()
    })

    it('ignores forged role names, feature arrays and super-admin claims', async () => {
      await expect(execute(context({ sub: actorId, tenantId, orgId: organizationId, roles: ['admin'], features: ['*'], isSuperAdmin: true })))
        .rejects.toMatchObject({ status: 403 })
      expect(mockFindOne).not.toHaveBeenCalled()
    })

    it.each([null, { sub: actorId, tenantId: null, orgId: organizationId }])('denies missing principal scope', async (auth) => {
      await expect(execute(context(auth))).rejects.toMatchObject({ status: 403 })
      expect(mockPermission).not.toHaveBeenCalled()
      expect(mockFindOne).not.toHaveBeenCalled()
    })

    it('fails closed when RBAC is unavailable', async () => {
      mockResolve.mockReturnValue(null)
      await expect(execute()).rejects.toMatchObject({ status: 403 })
      expect(mockFindOne).not.toHaveBeenCalled()
    })

    it('fails closed on RBAC errors', async () => {
      mockPermission.mockRejectedValue(new Error('RBAC unavailable'))
      await expect(execute()).rejects.toThrow('RBAC unavailable')
      expect(mockFindOne).not.toHaveBeenCalled()
    })

    it.each(['staff.leave_requests.manage', 'staff.*', '*'])('retains scoped lookup for custom-role grant %s', async (feature) => {
      mockPermission.mockImplementation(async (_principal, required) => authorizeFeatures(required, { grantedFeatures: [feature] }))
      await expect(execute()).rejects.toMatchObject({ status: 404 })
      expect(mockFindOne).toHaveBeenCalledWith(em, expect.anything(), {
        id: requestId, tenantId, organizationId, deletedAt: null,
      }, undefined, { tenantId, organizationId })
      expect(mockFlush).not.toHaveBeenCalled()
    })

    it.each([false, true])('checks the API-key principal rather than its owner (allowed=%s)', async (allowed) => {
      mockPermission.mockResolvedValue(allowed)
      const keyPrincipal = `api_key:${actorId}`
      await expect(execute(context({ sub: keyPrincipal, tenantId, orgId: organizationId, isApiKey: true, userId: actorId })))
        .rejects.toMatchObject({ status: allowed ? 404 : 403 })
      expect(mockPermission).toHaveBeenCalledWith(keyPrincipal, ['staff.leave_requests.manage'], { tenantId, organizationId })
    })

    it.each(['tenantId', 'organizationId'])('retains %s denial after permission succeeds', async (field) => {
      mockPermission.mockResolvedValue(true)
      const live = { id: requestId, tenantId, organizationId, status: 'pending', [field]: requestId }
      mockFindOne.mockResolvedValue(live)
      await expect(execute()).rejects.toMatchObject({ status: 403 })
      expect(live.status).toBe('pending')
      expect(mockFlush).not.toHaveBeenCalled()
      expect(mockEmit).not.toHaveBeenCalled()
    })

    it.each(['staff.leave_requests.manage', 'staff.*', '*'])('preserves successful decisions and planner effects for %s', async (feature) => {
      mockPermission.mockImplementation(async (_principal, required) => authorizeFeatures(required, { grantedFeatures: [feature] }))
      const live = {
        id: requestId, tenantId, organizationId, member: actorId, status: 'pending',
        startDate: new Date('2026-01-10T00:00:00Z'), endDate: new Date('2026-01-10T00:00:00Z'), timezone: 'UTC',
      }
      mockFindOne.mockResolvedValue(live)
      await expect(execute()).resolves.toMatchObject({ requestId })
      expect(live.status).toBe(decision === 'accept' ? 'approved' : 'rejected')
      expect(mockFlush).toHaveBeenCalled()
      expect(mockEmit).toHaveBeenCalled()
      if (decision === 'accept') {
        expect(em.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
          subjectId: actorId, tenantId, organizationId, kind: 'unavailability',
        }))
      } else {
        expect(em.create).not.toHaveBeenCalled()
      }
    })

    it('does not let input scope replace the trusted authorization scope', async () => {
      await expect(execute(context(), { tenantId: requestId, organizationId: requestId })).rejects.toMatchObject({ status: 403 })
      expect(mockPermission).toHaveBeenCalledWith(actorId, ['staff.leave_requests.manage'], { tenantId, organizationId })
    })
  })
}
