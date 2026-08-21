import { NextResponse } from 'next/server'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { EnforcementScope } from '../../../data/entities'
import { DELETE, PUT } from '../[id]/route'
import { assertActorOwnsEnforcementScope, resolveEnforcementContext } from '../_shared'

jest.mock('../../i18n', () => ({
  securityApiError: jest.fn((status: number, message: string) => NextResponse.json({ error: message }, { status })),
}))

jest.mock('../_shared', () => ({
  resolveEnforcementContext: jest.fn(),
  assertActorOwnsEnforcementScope: jest.fn(),
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

const tenantA = '33333333-3333-4333-8333-333333333333'
const tenantB = '44444444-4444-4444-8444-444444444444'
const policyId = '55555555-5555-4555-8555-555555555555'

function buildContext(options: { getPolicyById?: jest.Mock; commandExecute?: jest.Mock } = {}) {
  const execute = options.commandExecute ?? jest.fn(async () => ({ result: { ok: true } }))
  return {
    auth: { sub: 'admin-1', tenantId: tenantA, orgId: 'org-1' },
    container: { resolve: jest.fn(() => ({ execute })) },
    commandContext: {} as never,
    enforcementService: {
      getPolicyById:
        options.getPolicyById ??
        jest.fn(async () => ({
          id: policyId,
          scope: EnforcementScope.TENANT,
          tenantId: tenantB,
          organizationId: null,
        })),
    } as never,
  } as never
}

function params() {
  return { params: Promise.resolve({ id: policyId }) }
}

describe('security enforcement [id] route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedAssertActorOwnsEnforcementScope.mockResolvedValue(undefined)
  })

  test('update rejects when actor does not own the current policy scope', async () => {
    const commandExecute = jest.fn()
    mockedResolveEnforcementContext.mockResolvedValue(buildContext({ commandExecute }))
    mockedAssertActorOwnsEnforcementScope.mockRejectedValueOnce(forbidden('Not authorized to target this tenant.'))

    const req = new Request(`https://example.test/api/security/enforcement/${policyId}`, {
      method: 'PUT',
      body: JSON.stringify({ isEnforced: false }),
    })
    const response = await PUT(req, params())

    expect(response.status).toBe(403)
    expect(commandExecute).not.toHaveBeenCalled()
  })

  test('delete rejects when actor does not own the policy scope', async () => {
    const commandExecute = jest.fn()
    mockedResolveEnforcementContext.mockResolvedValue(buildContext({ commandExecute }))
    mockedAssertActorOwnsEnforcementScope.mockRejectedValueOnce(forbidden('Not authorized to target this tenant.'))

    const req = new Request(`https://example.test/api/security/enforcement/${policyId}`, { method: 'DELETE' })
    const response = await DELETE(req, params())

    expect(response.status).toBe(403)
    expect(commandExecute).not.toHaveBeenCalled()
  })

  test('delete dispatches the command for an owned policy scope', async () => {
    const commandExecute = jest.fn(async () => ({ result: { ok: true } }))
    const getPolicyById = jest.fn(async () => ({
      id: policyId,
      scope: EnforcementScope.TENANT,
      tenantId: tenantA,
      organizationId: null,
    }))
    mockedResolveEnforcementContext.mockResolvedValue(buildContext({ commandExecute, getPolicyById }))

    const req = new Request(`https://example.test/api/security/enforcement/${policyId}`, { method: 'DELETE' })
    const response = await DELETE(req, params())

    expect(response.status).toBe(200)
    expect(commandExecute).toHaveBeenCalled()
  })

  test('delete returns 404 when the policy does not exist', async () => {
    const commandExecute = jest.fn()
    const getPolicyById = jest.fn(async () => null)
    mockedResolveEnforcementContext.mockResolvedValue(buildContext({ commandExecute, getPolicyById }))

    const req = new Request(`https://example.test/api/security/enforcement/${policyId}`, { method: 'DELETE' })
    const response = await DELETE(req, params())

    expect(response.status).toBe(404)
    expect(commandExecute).not.toHaveBeenCalled()
  })
})
