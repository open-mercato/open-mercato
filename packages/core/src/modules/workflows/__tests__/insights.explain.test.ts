import type { EntityManager } from '@mikro-orm/postgresql'
import type { ExplainLoadContext, ExplainScope } from '@open-mercato/shared/modules/insights/explain'

const findWithDecryptionMock = jest.fn()
const resolveCodeDefinitionForInstanceMock = jest.fn()
const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('../lib/find-definition', () => ({
  resolveCodeDefinitionForInstance: (...args: unknown[]) => resolveCodeDefinitionForInstanceMock(...args),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ error: jest.fn() }) }),
}))

import explainConfig from '../insights.explain'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const INSTANCE_A = '44444444-4444-4444-8444-444444444444'
const INSTANCE_B = '55555555-5555-4555-8555-555555555555'
const INSTANCE_C = '66666666-6666-4666-8666-666666666666'
const DEFINITION_A = '77777777-7777-4777-8777-777777777777'
const CODE_DEFINITION = '88888888-8888-4888-8888-888888888888'
const MISSING_DEFINITION = '99999999-9999-4999-8999-999999999999'

function buildContext(scope: Partial<ExplainScope> = {}): ExplainLoadContext {
  return {
    em: {} as EntityManager,
    resolve: () => undefined,
    scope: { tenantId: TENANT_ID, organizationIds: null, ...scope },
    userId: null,
    locale: 'en',
  }
}

function getResolver() {
  const resolver = explainConfig.causeResolvers?.find((entry) => entry.kind === 'workflow')
  if (!resolver) throw new Error('[internal] missing workflow cause resolver')
  return resolver
}

describe('workflows insights.explain', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    resolveCodeDefinitionForInstanceMock.mockReset()
    reportErrorMock.mockReset()
  })

  it('declares the workflow cause resolver behind the instance view feature', () => {
    expect(explainConfig.version).toBe(1)
    expect(explainConfig.resources).toBeUndefined()
    expect(getResolver().requiredFeatures).toEqual(['workflows.instances.view'])
  })

  it('resolves instances and definitions in batched, scoped queries', async () => {
    findWithDecryptionMock
      .mockResolvedValueOnce([
        { id: INSTANCE_A, definitionId: DEFINITION_A, workflowId: 'order-approval', organizationId: ORG_A, deletedAt: null },
        { id: INSTANCE_B, definitionId: CODE_DEFINITION, workflowId: 'code-flow', organizationId: ORG_A, deletedAt: null },
        { id: INSTANCE_C, definitionId: MISSING_DEFINITION, workflowId: 'orphan-flow', organizationId: ORG_A, deletedAt: new Date() },
      ])
      .mockResolvedValueOnce([{ id: DEFINITION_A, workflowName: 'Order approval' }])
    resolveCodeDefinitionForInstanceMock.mockImplementation((instance: { workflowId: string }) =>
      instance.workflowId === 'code-flow' ? { workflowName: 'Code flow' } : null,
    )
    const details = await getResolver().resolve(buildContext({ organizationIds: [ORG_A] }), [
      INSTANCE_A,
      INSTANCE_A,
      INSTANCE_B,
      INSTANCE_C,
      'not-a-uuid',
    ])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(2)
    expect(findWithDecryptionMock.mock.calls[0][2]).toEqual({
      id: { $in: [INSTANCE_A, INSTANCE_B, INSTANCE_C] },
      tenantId: TENANT_ID,
      organizationId: { $in: [ORG_A] },
    })
    expect(findWithDecryptionMock.mock.calls[1][2]).toEqual({
      id: { $in: [DEFINITION_A, CODE_DEFINITION, MISSING_DEFINITION] },
      tenantId: TENANT_ID,
      organizationId: { $in: [ORG_A] },
    })
    expect(details).toEqual([
      { kind: 'workflow', id: INSTANCE_A, label: 'Order approval', href: `/backend/instances/${INSTANCE_A}`, organizationId: ORG_A },
      { kind: 'workflow', id: INSTANCE_B, label: 'Code flow', href: `/backend/instances/${INSTANCE_B}`, organizationId: ORG_A },
      { kind: 'workflow', id: INSTANCE_C, label: 'orphan-flow', href: null, organizationId: ORG_A },
    ])
  })

  it('queries tenant-wide for an unrestricted scope and skips definitions when nothing matched', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([])
    await expect(getResolver().resolve(buildContext(), [INSTANCE_A])).resolves.toEqual([])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock.mock.calls[0][2]).toEqual({ id: { $in: [INSTANCE_A] }, tenantId: TENANT_ID })
  })

  it('denies an empty organization scope without querying', async () => {
    await expect(getResolver().resolve(buildContext({ organizationIds: [] }), [INSTANCE_A])).resolves.toEqual([])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('returns [] and reports when the lookup fails', async () => {
    findWithDecryptionMock.mockRejectedValueOnce(new Error('db down'))
    await expect(getResolver().resolve(buildContext(), [INSTANCE_A])).resolves.toEqual([])
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), {
      module: 'workflows',
      code: 'workflows.insights_cause_failed',
      attributes: { kind: 'workflow' },
    })
  })
})
