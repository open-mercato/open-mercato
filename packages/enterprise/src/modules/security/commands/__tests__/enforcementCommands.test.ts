import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { EnforcementScope } from '../../data/entities'
import '../createEnforcementPolicy'

function buildContext(opts: {
  auth: Record<string, unknown>
  createPolicy: jest.Mock
}) {
  return {
    auth: opts.auth,
    container: {
      resolve: (name: string) => {
        if (name === 'mfaEnforcementService') {
          return { createPolicy: opts.createPolicy }
        }
        throw new Error(`Unexpected dependency: ${name}`)
      },
    },
  } as never
}

describe('security enforcement commands', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('create command forwards a scope built from ctx.auth to the service', async () => {
    const handler = commandRegistry.get('security.enforcement.create')
    expect(handler).toBeTruthy()

    const createPolicy = jest.fn().mockResolvedValue({ id: 'policy-1' })

    await handler!.execute(
      {
        scope: EnforcementScope.TENANT,
        tenantId: '11111111-1111-4111-8111-111111111111',
        isEnforced: true,
      },
      buildContext({
        auth: {
          sub: 'admin-1',
          tenantId: '11111111-1111-4111-8111-111111111111',
          orgId: '22222222-2222-4222-8222-222222222222',
          isSuperAdmin: false,
        },
        createPolicy,
      }),
    )

    expect(createPolicy).toHaveBeenCalledTimes(1)
    expect(createPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ scope: EnforcementScope.TENANT, tenantId: '11111111-1111-4111-8111-111111111111' }),
      'admin-1',
      {
        tenantId: '11111111-1111-4111-8111-111111111111',
        organizationId: '22222222-2222-4222-8222-222222222222',
        isSuperAdmin: false,
      },
    )
  })

  test('create command treats missing isSuperAdmin as false and missing orgId as null', async () => {
    const handler = commandRegistry.get('security.enforcement.create')
    const createPolicy = jest.fn().mockResolvedValue({ id: 'policy-2' })

    await handler!.execute(
      {
        scope: EnforcementScope.TENANT,
        tenantId: '33333333-3333-4333-8333-333333333333',
        isEnforced: true,
      },
      buildContext({
        auth: {
          sub: 'admin-2',
          tenantId: '33333333-3333-4333-8333-333333333333',
          // orgId and isSuperAdmin omitted
        },
        createPolicy,
      }),
    )

    expect(createPolicy).toHaveBeenCalledWith(
      expect.any(Object),
      'admin-2',
      { tenantId: '33333333-3333-4333-8333-333333333333', organizationId: null, isSuperAdmin: false },
    )
  })

  test('create command builds superadmin scope when ctx.auth.isSuperAdmin is true', async () => {
    const handler = commandRegistry.get('security.enforcement.create')
    const createPolicy = jest.fn().mockResolvedValue({ id: 'policy-3' })

    await handler!.execute(
      { scope: EnforcementScope.PLATFORM, isEnforced: true },
      buildContext({
        auth: {
          sub: 'root-1',
          tenantId: null,
          orgId: null,
          isSuperAdmin: true,
        },
        createPolicy,
      }),
    )

    expect(createPolicy).toHaveBeenCalledWith(
      expect.any(Object),
      'root-1',
      { tenantId: null, organizationId: null, isSuperAdmin: true },
    )
  })

  test('create command maps service 403 error to CrudHttpError', async () => {
    const handler = commandRegistry.get('security.enforcement.create')
    const error = Object.assign(new Error('Insufficient scope for enforcement policy'), {
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
    })
    const createPolicy = jest.fn().mockRejectedValue(error)

    await expect(
      handler!.execute(
        {
          scope: EnforcementScope.PLATFORM,
          isEnforced: false,
        },
        buildContext({
          auth: { sub: 'admin-1', tenantId: 'tenant-1', orgId: null, isSuperAdmin: false },
          createPolicy,
        }),
      ),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 403,
      body: { error: 'Insufficient scope for enforcement policy' },
    })
  })

  test('create command rejects with 401 when ctx.auth.sub is missing', async () => {
    const handler = commandRegistry.get('security.enforcement.create')
    const createPolicy = jest.fn()

    await expect(
      handler!.execute(
        {
          scope: EnforcementScope.TENANT,
          tenantId: '44444444-4444-4444-8444-444444444444',
          isEnforced: true,
        },
        buildContext({ auth: {}, createPolicy }),
      ),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 401,
    })
    expect(createPolicy).not.toHaveBeenCalled()
  })
})
