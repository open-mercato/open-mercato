import { NextResponse } from 'next/server'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { EnforcementScope } from '../../../data/entities'
import { GET, POST } from '../route'
import {
  assertActorOwnsEnforcementScope,
  attachPolicyScopeNames,
  resolveActorContext,
  resolveEnforcementContext,
} from '../_shared'

jest.mock('../../i18n', () => ({
  securityApiError: jest.fn((status: number, message: string) => NextResponse.json({ error: message }, { status })),
}))

jest.mock('../_shared', () => ({
  resolveEnforcementContext: jest.fn(),
  assertActorOwnsEnforcementScope: jest.fn(),
  resolveActorContext: jest.fn(),
  attachPolicyScopeNames: jest.fn(async () => []),
  mapEnforcementError: jest.fn((error: unknown) => {
    if (error instanceof Error && 'status' in error && 'body' in error) {
      const status = (error as Error & { status: number }).status
      const body = (error as Error & { body?: unknown }).body
      return NextResponse.json(body, { status })
    }
    return NextResponse.json({ error: 'Failed to process enforcement request.' }, { status: 500 })
  }),
}))

const mockedResolveEnforcementContext = resolveEnforcementContext as jest.MockedFunction<typeof resolveEnforcementContext>
const mockedAssertActorOwnsEnforcementScope = assertActorOwnsEnforcementScope as jest.MockedFunction<typeof assertActorOwnsEnforcementScope>
const mockedResolveActorContext = resolveActorContext as jest.MockedFunction<typeof resolveActorContext>
const mockedAttachPolicyScopeNames = attachPolicyScopeNames as jest.MockedFunction<typeof attachPolicyScopeNames>

const tenantA = '33333333-3333-4333-8333-333333333333'
const tenantB = '44444444-4444-4444-8444-444444444444'

function buildContext(options: { listPolicies?: jest.Mock; commandExecute?: jest.Mock } = {}) {
  const execute = options.commandExecute ?? jest.fn(async () => ({ result: { id: 'policy-1' } }))
  return {
    auth: { sub: 'admin-1', tenantId: tenantA, orgId: 'org-1' },
    container: { resolve: jest.fn(() => ({ execute })) },
    commandContext: {} as never,
    enforcementService: { listPolicies: options.listPolicies ?? jest.fn(async () => []) } as never,
  } as never
}

describe('security enforcement list/create route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedResolveActorContext.mockResolvedValue({ tenantId: tenantA, isSuperAdmin: false })
    mockedAssertActorOwnsEnforcementScope.mockResolvedValue(undefined)
    mockedAttachPolicyScopeNames.mockResolvedValue([])
  })

  test('list passes actor context to the service for a non-superadmin', async () => {
    const listPolicies = jest.fn(async () => [])
    mockedResolveEnforcementContext.mockResolvedValue(buildContext({ listPolicies }))

    const req = new Request('https://example.test/api/security/enforcement', { method: 'GET' })
    const response = await GET(req)

    expect(response.status).toBe(200)
    expect(listPolicies).toHaveBeenCalledWith({ scope: undefined }, { tenantId: tenantA, isSuperAdmin: false })
  })

  test('create rejects a foreign tenant scope before dispatching the command', async () => {
    const commandExecute = jest.fn()
    mockedResolveEnforcementContext.mockResolvedValue(buildContext({ commandExecute }))
    mockedAssertActorOwnsEnforcementScope.mockRejectedValueOnce(forbidden('Not authorized to target this tenant.'))

    const req = new Request('https://example.test/api/security/enforcement', {
      method: 'POST',
      body: JSON.stringify({ scope: 'tenant', tenantId: tenantB, isEnforced: true }),
    })
    const response = await POST(req)

    expect(response.status).toBe(403)
    expect(commandExecute).not.toHaveBeenCalled()
  })

  test('create dispatches the command for an owned tenant scope', async () => {
    const commandExecute = jest.fn(async () => ({ result: { id: 'policy-1' } }))
    mockedResolveEnforcementContext.mockResolvedValue(buildContext({ commandExecute }))

    const req = new Request('https://example.test/api/security/enforcement', {
      method: 'POST',
      body: JSON.stringify({ scope: 'tenant', tenantId: tenantA, isEnforced: true }),
    })
    const response = await POST(req)

    expect(response.status).toBe(201)
    expect(mockedAssertActorOwnsEnforcementScope).toHaveBeenCalledWith(expect.anything(), EnforcementScope.TENANT, tenantA)
    expect(commandExecute).toHaveBeenCalled()
  })
})
