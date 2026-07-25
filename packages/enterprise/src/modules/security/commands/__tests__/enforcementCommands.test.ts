import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { EnforcementScope } from '../../data/entities'
import '../createEnforcementPolicy'
import '../updateEnforcementPolicy'
import '../deleteEnforcementPolicy'

function buildContext(opts: {
  auth: Record<string, unknown>
  createPolicy?: jest.Mock
  updatePolicy?: jest.Mock
  deletePolicy?: jest.Mock
}) {
  return {
    auth: opts.auth,
    container: {
      resolve: (name: string) => {
        if (name === 'mfaEnforcementService') {
          return {
            ...(opts.createPolicy ? { createPolicy: opts.createPolicy } : {}),
            ...(opts.updatePolicy ? { updatePolicy: opts.updatePolicy } : {}),
            ...(opts.deletePolicy ? { deletePolicy: opts.deletePolicy } : {}),
          }
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

  const policyId = '55555555-5555-4555-8555-555555555555'

  test('update command forwards a scope built from ctx.auth to the service', async () => {
    const handler = commandRegistry.get('security.enforcement.update')
    expect(handler).toBeTruthy()

    const updatePolicy = jest.fn().mockResolvedValue({ id: policyId })

    await handler!.execute(
      {
        id: policyId,
        data: { isEnforced: false },
      },
      buildContext({
        auth: {
          sub: 'admin-1',
          tenantId: '11111111-1111-4111-8111-111111111111',
          orgId: '22222222-2222-4222-8222-222222222222',
          isSuperAdmin: false,
        },
        updatePolicy,
      }),
    )

    expect(updatePolicy).toHaveBeenCalledTimes(1)
    expect(updatePolicy).toHaveBeenCalledWith(
      policyId,
      expect.objectContaining({ isEnforced: false }),
      'admin-1',
      {
        tenantId: '11111111-1111-4111-8111-111111111111',
        organizationId: '22222222-2222-4222-8222-222222222222',
        isSuperAdmin: false,
      },
    )
  })

  test('update command treats missing isSuperAdmin as false and missing orgId as null', async () => {
    const handler = commandRegistry.get('security.enforcement.update')
    const updatePolicy = jest.fn().mockResolvedValue({ id: policyId })

    await handler!.execute(
      {
        id: policyId,
        data: { isEnforced: true },
      },
      buildContext({
        auth: {
          sub: 'admin-2',
          tenantId: '33333333-3333-4333-8333-333333333333',
          // orgId and isSuperAdmin omitted
        },
        updatePolicy,
      }),
    )

    expect(updatePolicy).toHaveBeenCalledWith(
      policyId,
      expect.any(Object),
      'admin-2',
      { tenantId: '33333333-3333-4333-8333-333333333333', organizationId: null, isSuperAdmin: false },
    )
  })

  test('update command builds superadmin scope when ctx.auth.isSuperAdmin is true', async () => {
    const handler = commandRegistry.get('security.enforcement.update')
    const updatePolicy = jest.fn().mockResolvedValue({ id: policyId })

    await handler!.execute(
      {
        id: policyId,
        data: { scope: EnforcementScope.PLATFORM, tenantId: null },
      },
      buildContext({
        auth: {
          sub: 'root-1',
          tenantId: null,
          orgId: null,
          isSuperAdmin: true,
        },
        updatePolicy,
      }),
    )

    expect(updatePolicy).toHaveBeenCalledWith(
      policyId,
      expect.any(Object),
      'root-1',
      { tenantId: null, organizationId: null, isSuperAdmin: true },
    )
  })

  test('update command maps service 403 error to CrudHttpError', async () => {
    const handler = commandRegistry.get('security.enforcement.update')
    const error = Object.assign(new Error('Insufficient scope for enforcement policy'), {
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
    })
    const updatePolicy = jest.fn().mockRejectedValue(error)

    await expect(
      handler!.execute(
        { id: policyId, data: { scope: EnforcementScope.PLATFORM } },
        buildContext({
          auth: { sub: 'admin-1', tenantId: 'tenant-1', orgId: null, isSuperAdmin: false },
          updatePolicy,
        }),
      ),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 403,
      body: { error: 'Insufficient scope for enforcement policy' },
    })
  })

  test('update command rejects with 401 when ctx.auth.sub is missing', async () => {
    const handler = commandRegistry.get('security.enforcement.update')
    const updatePolicy = jest.fn()

    await expect(
      handler!.execute(
        { id: policyId, data: { isEnforced: false } },
        buildContext({ auth: {}, updatePolicy }),
      ),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 401,
    })
    expect(updatePolicy).not.toHaveBeenCalled()
  })

  test('update command rejects with 400 when input fails commandSchema validation', async () => {
    const handler = commandRegistry.get('security.enforcement.update')
    const updatePolicy = jest.fn()

    await expect(
      handler!.execute(
        { id: 'not-a-uuid', data: {} },
        buildContext({
          auth: { sub: 'admin-1', tenantId: 'tenant-1', orgId: null, isSuperAdmin: false },
          updatePolicy,
        }),
      ),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 400,
    })
    expect(updatePolicy).not.toHaveBeenCalled()
  })

  test('delete command forwards a scope built from ctx.auth to the service', async () => {
    const handler = commandRegistry.get('security.enforcement.delete')
    expect(handler).toBeTruthy()

    const deletePolicy = jest.fn().mockResolvedValue(undefined)

    await handler!.execute(
      { id: policyId },
      buildContext({
        auth: {
          sub: 'admin-1',
          tenantId: '11111111-1111-4111-8111-111111111111',
          orgId: '22222222-2222-4222-8222-222222222222',
          isSuperAdmin: false,
        },
        deletePolicy,
      }),
    )

    expect(deletePolicy).toHaveBeenCalledTimes(1)
    expect(deletePolicy).toHaveBeenCalledWith(policyId, {
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      isSuperAdmin: false,
    })
  })

  test('delete command treats missing isSuperAdmin as false and missing orgId as null', async () => {
    const handler = commandRegistry.get('security.enforcement.delete')
    const deletePolicy = jest.fn().mockResolvedValue(undefined)

    await handler!.execute(
      { id: policyId },
      buildContext({
        auth: {
          sub: 'admin-2',
          tenantId: '33333333-3333-4333-8333-333333333333',
        },
        deletePolicy,
      }),
    )

    expect(deletePolicy).toHaveBeenCalledWith(policyId, {
      tenantId: '33333333-3333-4333-8333-333333333333',
      organizationId: null,
      isSuperAdmin: false,
    })
  })

  test('delete command builds superadmin scope when ctx.auth.isSuperAdmin is true', async () => {
    const handler = commandRegistry.get('security.enforcement.delete')
    const deletePolicy = jest.fn().mockResolvedValue(undefined)

    await handler!.execute(
      { id: policyId },
      buildContext({
        auth: { sub: 'root-1', tenantId: null, orgId: null, isSuperAdmin: true },
        deletePolicy,
      }),
    )

    expect(deletePolicy).toHaveBeenCalledWith(policyId, {
      tenantId: null,
      organizationId: null,
      isSuperAdmin: true,
    })
  })

  test('delete command maps service 403 error to CrudHttpError', async () => {
    const handler = commandRegistry.get('security.enforcement.delete')
    const error = Object.assign(new Error('Insufficient scope for enforcement policy'), {
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
    })
    const deletePolicy = jest.fn().mockRejectedValue(error)

    await expect(
      handler!.execute(
        { id: policyId },
        buildContext({
          auth: { sub: 'admin-1', tenantId: 'tenant-1', orgId: null, isSuperAdmin: false },
          deletePolicy,
        }),
      ),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 403,
      body: { error: 'Insufficient scope for enforcement policy' },
    })
  })

  test('delete command rejects with 401 when ctx.auth.sub is missing', async () => {
    const handler = commandRegistry.get('security.enforcement.delete')
    const deletePolicy = jest.fn()

    await expect(
      handler!.execute(
        { id: policyId },
        buildContext({ auth: {}, deletePolicy }),
      ),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 401,
    })
    expect(deletePolicy).not.toHaveBeenCalled()
  })

  test('delete command rejects with 400 when input fails commandSchema validation', async () => {
    const handler = commandRegistry.get('security.enforcement.delete')
    const deletePolicy = jest.fn()

    await expect(
      handler!.execute(
        { id: 'not-a-uuid' },
        buildContext({
          auth: { sub: 'admin-1', tenantId: 'tenant-1', orgId: null, isSuperAdmin: false },
          deletePolicy,
        }),
      ),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 400,
    })
    expect(deletePolicy).not.toHaveBeenCalled()
  })
})
