const mockLoggerWarn = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({
    warn: mockLoggerWarn,
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    child() {
      return this
    },
  }),
}))

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveCreatorUserId } from '../shared'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const KEY_ID = '44444444-4444-4444-8444-444444444444'

type ContextOverrides = Partial<Omit<CommandRuntimeContext, 'auth'>> & {
  auth?: CommandRuntimeContext['auth']
}

function context(overrides: ContextOverrides = {}): CommandRuntimeContext {
  return {
    container: { resolve: () => undefined } as unknown as CommandRuntimeContext['container'],
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: null },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    ...overrides,
  }
}

function resolve(overrides: ContextOverrides = {}, tenantId = TENANT_ID): string | null {
  return resolveCreatorUserId(context(overrides), { tenantId })
}

describe('resolveCreatorUserId', () => {
  beforeEach(() => {
    mockLoggerWarn.mockClear()
  })

  it('returns the authenticated same-tenant staff subject', () => {
    expect(resolve()).toBe(USER_ID)
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it.each([
    ['API key with userId', { auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: null, isApiKey: true, userId: USER_ID } }],
    ['API key without userId', { auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: null, isApiKey: true } }],
    ['keyId-only key context', { auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: null, keyId: KEY_ID } }],
    ['api_key subject without isApiKey', { auth: { sub: `api_key:${KEY_ID}`, tenantId: TENANT_ID, orgId: null } }],
    ['agent runAs context', { runAs: { actorUserId: USER_ID, onBehalfOfUserId: USER_ID, source: 'agent' as const } }],
    ['system actor with UUID subject', { systemActor: true }],
    ['missing auth', { auth: null }],
    ['different effective tenant', { auth: { sub: USER_ID, tenantId: OTHER_TENANT_ID, orgId: null } }],
    ['missing home tenant', { auth: { sub: USER_ID, tenantId: null, orgId: null } }],
  ])('returns null without warning for %s', (_label, overrides) => {
    expect(resolve(overrides)).toBeNull()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('warns once only after a same-tenant non-key actor reaches the invalid-subject step', () => {
    expect(resolve({ auth: { sub: 'staff-user', tenantId: TENANT_ID, orgId: null } })).toBeNull()
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
    expect(mockLoggerWarn).toHaveBeenCalledWith('customers.creator_unresolved')
  })

  it.each([
    ['different actor tenant', OTHER_TENANT_ID, null],
    ['equal actor tenant', TENANT_ID, USER_ID],
    ['explicit null actor tenant', null, null],
  ])('uses actorTenantId presence semantics for a super-admin: %s', (_label, actorTenantId, expected) => {
    expect(resolve({
      auth: {
        sub: USER_ID,
        tenantId: TENANT_ID,
        orgId: null,
        isSuperAdmin: true,
        actorTenantId,
      },
    })).toBe(expected)
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('falls back to auth.tenantId when actorTenantId is absent', () => {
    expect(resolve({
      auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: null, isSuperAdmin: true },
    })).toBe(USER_ID)
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('rejects a record tenant different from the actor home tenant', () => {
    expect(resolve({}, OTHER_TENANT_ID)).toBeNull()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })
})
