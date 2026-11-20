import { AgentRun } from '../data/entities'

const create = jest.fn(async () => ({}))
const createForFeature = jest.fn(async () => [])

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ create, createForFeature }),
}))

import handle, {
  TRACE_VIEW_FEATURE,
  UNATTENDED_REVIEWER_FEATURE,
  buildRunReviewLinkHref,
} from '../subscribers/run-review-requested-notification'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '44444444-4444-4444-8444-444444444444'
const RUN = '33333333-3333-4333-8333-333333333333'
const USER = '55555555-5555-4555-8555-555555555555'

type Row = Record<string, unknown> | null

function ctxWith(row: Row, options: { canViewTraces?: boolean; rbacThrows?: boolean; organizationId?: string } = {}) {
  const userHasAllFeatures = jest.fn(async () => {
    if (options.rbacThrows) throw new Error('rbac down')
    return options.canViewTraces ?? true
  })
  const em = {
    fork() {
      return em
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      if (entity !== AgentRun || !row) return null
      const matches = Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value)
      return matches ? row : null
    },
  }
  const ctx = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'rbacService') return { userHasAllFeatures }
      return undefined
    },
    tenantId: TENANT,
    organizationId: options.organizationId ?? ORG,
  } as never
  return { ctx, userHasAllFeatures }
}

function researchRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RUN,
    tenantId: TENANT,
    organizationId: ORG,
    agentId: 'support.policy_research',
    source: 'runtime',
    resultKind: 'research',
    proposalId: null,
    ...overrides,
  }
}

function reviewEvent(overrides: Record<string, unknown> = {}) {
  return {
    agentRunId: RUN,
    agentId: 'support.policy_research',
    ruleId: 'needs-human',
    reasons: ['retrieval_empty'],
    tenantId: TENANT,
    organizationId: ORG,
    ...overrides,
  }
}

beforeEach(() => {
  create.mockClear()
  createForFeature.mockClear()
})

describe('run review requested notification', () => {
  it('addresses the person who started the run when they can open traces', async () => {
    const { ctx, userHasAllFeatures } = ctxWith(researchRun())
    await handle(reviewEvent({ invokedByUserId: USER }), ctx)

    expect(userHasAllFeatures).toHaveBeenCalledWith(USER, [TRACE_VIEW_FEATURE], { tenantId: TENANT, organizationId: ORG })
    expect(createForFeature).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(1)
    const [input, scope] = create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>]
    expect(input.recipientUserId).toBe(USER)
    expect(input.type).toBe('agent_orchestrator.run.review_requested')
    expect(input.linkHref).toBe('/backend/traces?agent=support.policy_research&facet=needs-review')
    expect(input.sourceEntityId).toBe(RUN)
    expect(scope).toEqual({ tenantId: TENANT, organizationId: ORG })
  })

  it('carries only the agent id, never reasons, input or output', async () => {
    const { ctx } = ctxWith(researchRun({ input: { secret: 'x' }, output: { kind: 'research', data: { note: 'y' } } }))
    await handle(reviewEvent({ invokedByUserId: USER }), ctx)

    const [input] = create.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(input.bodyVariables).toEqual({ agent: 'support.policy_research' })
    expect(input.titleVariables).toBeUndefined()
    expect(JSON.stringify(input)).not.toContain('retrieval_empty')
    expect(JSON.stringify(input)).not.toContain('secret')
  })

  it('falls back to the org-restricted reviewer group when the invoker cannot open traces', async () => {
    const { ctx } = ctxWith(researchRun(), { canViewTraces: false })
    await handle(reviewEvent({ invokedByUserId: USER }), ctx)

    expect(create).not.toHaveBeenCalled()
    expect(createForFeature).toHaveBeenCalledTimes(1)
    const [input, scope] = createForFeature.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>]
    expect(input.requiredFeature).toBe(UNATTENDED_REVIEWER_FEATURE)
    expect(input.restrictRecipientsToOrganization).toBe(true)
    expect(scope).toEqual({ tenantId: TENANT, organizationId: ORG })
  })

  it('falls back to the reviewer group when the permission check fails', async () => {
    const { ctx } = ctxWith(researchRun(), { rbacThrows: true })
    await handle(reviewEvent({ invokedByUserId: USER }), ctx)

    expect(create).not.toHaveBeenCalled()
    expect(createForFeature).toHaveBeenCalledTimes(1)
  })

  it('sends unattended runs (no invoker) to the org-restricted reviewer group', async () => {
    const { ctx, userHasAllFeatures } = ctxWith(researchRun())
    await handle(reviewEvent(), ctx)

    expect(userHasAllFeatures).not.toHaveBeenCalled()
    expect(createForFeature).toHaveBeenCalledTimes(1)
    const [input] = createForFeature.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(input.requiredFeature).toBe('agent_orchestrator.guardrail.manage')
    expect(input.restrictRecipientsToOrganization).toBe(true)
  })

  it('groups per agent, so later runs of the same agent refresh one notification', async () => {
    const { ctx } = ctxWith(researchRun())
    await handle(reviewEvent(), ctx)
    const second = ctxWith(researchRun({ id: '66666666-6666-4666-8666-666666666666' }))
    await handle(reviewEvent({ agentRunId: '66666666-6666-4666-8666-666666666666' }), second.ctx)

    const keys = createForFeature.mock.calls.map((call) => (call[0] as unknown as Record<string, unknown>).groupKey)
    expect(keys).toEqual([
      'agent_orchestrator.run.review_requested:support.policy_research',
      'agent_orchestrator.run.review_requested:support.policy_research',
    ])
  })

  it('stays silent for proposal runs, which the proposal notification already covers', async () => {
    await handle(reviewEvent(), ctxWith(researchRun({ resultKind: 'proposal' })).ctx)
    await handle(reviewEvent(), ctxWith(researchRun({ proposalId: '77777777-7777-4777-8777-777777777777' })).ctx)
    expect(create).not.toHaveBeenCalled()
    expect(createForFeature).not.toHaveBeenCalled()
  })

  it('stays silent for an eval replay', async () => {
    await handle(reviewEvent({ invokedByUserId: USER }), ctxWith(researchRun({ source: 'eval' })).ctx)
    expect(create).not.toHaveBeenCalled()
    expect(createForFeature).not.toHaveBeenCalled()
  })

  it('notifies nobody when the run belongs to another organization', async () => {
    await handle(
      reviewEvent({ invokedByUserId: USER, organizationId: OTHER_ORG }),
      ctxWith(researchRun(), { organizationId: OTHER_ORG }).ctx,
    )
    expect(create).not.toHaveBeenCalled()
    expect(createForFeature).not.toHaveBeenCalled()
  })

  it('stays silent when the run is gone or the event carries no scope', async () => {
    await handle(reviewEvent(), ctxWith(null).ctx)
    await handle(
      { agentRunId: RUN },
      { resolve: () => undefined, tenantId: null, organizationId: null } as never,
    )
    expect(create).not.toHaveBeenCalled()
    expect(createForFeature).not.toHaveBeenCalled()
  })

  it('encodes the agent id in the deep link', () => {
    expect(buildRunReviewLinkHref('a&b=c')).toBe('/backend/traces?agent=a%26b%3Dc&facet=needs-review')
  })
})
