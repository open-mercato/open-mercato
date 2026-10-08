import type { EntityManager } from '@mikro-orm/postgresql'
import type { ExplainLoadContext, ExplainScope } from '@open-mercato/shared/modules/insights/explain'

const findWithDecryptionMock = jest.fn()
const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
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
const ACTION_A = '44444444-4444-4444-8444-444444444444'
const ACTION_B = '55555555-5555-4555-8555-555555555555'

function buildContext(scope: Partial<ExplainScope> = {}): ExplainLoadContext {
  return {
    em: {} as EntityManager,
    resolve: () => undefined,
    scope: { tenantId: TENANT_ID, organizationIds: null, ...scope },
    userId: null,
    locale: 'en',
  }
}

function getResolver(kind: 'ai_action' | 'ai_tool') {
  const resolver = explainConfig.causeResolvers?.find((entry) => entry.kind === kind)
  if (!resolver) throw new Error(`[internal] missing ${kind} cause resolver`)
  return resolver
}

describe('ai_assistant insights.explain', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    reportErrorMock.mockReset()
  })

  it('declares the AI cause resolvers behind the assistant view feature', () => {
    expect(explainConfig.version).toBe(1)
    expect(explainConfig.causeResolvers?.map((resolver) => [resolver.kind, resolver.requiredFeatures])).toEqual([
      ['ai_action', ['ai_assistant.view']],
      ['ai_tool', ['ai_assistant.view']],
    ])
  })

  it('resolves pending actions in one scoped query with agent and tool labels', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([
      { id: ACTION_A, agentId: 'customers.account_assistant', toolName: 'customers.update_deal_stage', organizationId: ORG_A },
      { id: ACTION_B, agentId: '', toolName: 'sales.update_order', organizationId: null },
    ])
    const details = await getResolver('ai_action').resolve(buildContext({ organizationIds: [ORG_A] }), [
      ACTION_A,
      ACTION_B,
      ACTION_A,
      'customers.update_deal_stage',
    ])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock.mock.calls[0][2]).toEqual({
      id: { $in: [ACTION_A, ACTION_B] },
      tenantId: TENANT_ID,
      $or: [{ organizationId: null }, { organizationId: { $in: [ORG_A] } }],
    })
    expect(details).toEqual([
      {
        kind: 'ai_action',
        id: ACTION_A,
        label: 'customers.account_assistant / customers.update_deal_stage',
        href: null,
        organizationId: ORG_A,
      },
      { kind: 'ai_action', id: ACTION_B, label: 'sales.update_order', href: null, organizationId: null },
    ])
  })

  it('labels AI tool causes by tool name without touching the database', async () => {
    const details = await getResolver('ai_tool').resolve(buildContext(), ['customers.update_deal', ' customers.update_deal ', ''])
    expect(details).toEqual([
      { kind: 'ai_tool', id: 'customers.update_deal', label: 'customers.update_deal', href: null, organizationId: null },
    ])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('skips the query for a denied scope', async () => {
    await expect(getResolver('ai_action').resolve(buildContext({ organizationIds: [] }), [ACTION_A])).resolves.toEqual([])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('returns [] and reports when the lookup fails', async () => {
    findWithDecryptionMock.mockRejectedValueOnce(new Error('db down'))
    await expect(getResolver('ai_action').resolve(buildContext(), [ACTION_A])).resolves.toEqual([])
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), {
      module: 'ai_assistant',
      code: 'ai_assistant.insights_cause_failed',
      attributes: { kind: 'ai_action' },
    })
  })
})
