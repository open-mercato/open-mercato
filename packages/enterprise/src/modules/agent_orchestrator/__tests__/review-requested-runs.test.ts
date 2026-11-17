const findWithDecryption = jest.fn(async () => [] as Array<{ agentRunId: string }>)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...(args as [])),
}))

import { AgentGuardrailCheck } from '../data/entities'
import {
  REVIEW_REQUESTED_RUN_ID_LIMIT,
  findReviewRequestedRunIds,
} from '../lib/guardrails/integrity/reviewRequestedRuns'

const em = {} as never

beforeEach(() => {
  findWithDecryption.mockReset().mockResolvedValue([])
})

describe('findReviewRequestedRunIds', () => {
  it('reads abstain_or_review warn checks inside the caller tenant and organizations', async () => {
    findWithDecryption.mockResolvedValue([{ agentRunId: 'run-1' }, { agentRunId: 'run-2' }, { agentRunId: 'run-1' }])
    const createdAfter = new Date('2026-11-01T00:00:00Z')

    const ids = await findReviewRequestedRunIds(em, { tenantId: 'tenant-1', organizationIds: ['org-1'], createdAfter })

    expect(ids).toEqual(['run-1', 'run-2'])
    const [, entity, where, options] = findWithDecryption.mock.calls[0] as unknown as [unknown, unknown, Record<string, unknown>, Record<string, unknown>]
    expect(entity).toBe(AgentGuardrailCheck)
    expect(where).toEqual({
      tenantId: 'tenant-1',
      kind: 'abstain_or_review',
      result: 'warn',
      organizationId: { $in: ['org-1'] },
      createdAt: { $gte: createdAfter },
    })
    expect(options).toMatchObject({ limit: REVIEW_REQUESTED_RUN_ID_LIMIT, orderBy: { createdAt: 'desc' } })
  })

  it('stays tenant-scoped when the caller may see every organization', async () => {
    await findReviewRequestedRunIds(em, { tenantId: 'tenant-1', organizationIds: null })
    const [, , where] = findWithDecryption.mock.calls[0] as unknown as [unknown, unknown, Record<string, unknown>]
    expect(where.tenantId).toBe('tenant-1')
    expect(where).not.toHaveProperty('organizationId')
  })

  it('returns nothing without a tenant or with an empty organization scope', async () => {
    expect(await findReviewRequestedRunIds(em, { tenantId: null, organizationIds: null })).toEqual([])
    expect(await findReviewRequestedRunIds(em, { tenantId: 'tenant-1', organizationIds: [] })).toEqual([])
    expect(findWithDecryption).not.toHaveBeenCalled()
  })
})
