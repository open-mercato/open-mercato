const findOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...a: unknown[]) => findOneWithDecryption(...a),
}))

import { notifyStep } from '../notify'
import type { AutomationContext } from '../../lib/engine/types'

/**
 * `team` notices must stay inside the run's own organization: `createForFeature` resolves candidates
 * tenant-wide unless told otherwise, and a tenant can span organizations with different grants.
 */
const scope = { tenantId: 't1', organizationId: 'o1' }

const ctx = (over: Partial<AutomationContext> = {}): AutomationContext => ({
  tenantId: 't1', organizationId: 'o1', eventId: 'e', occurredAt: '2026-09-30T00:00:00.000Z',
  dispatchDepth: 1, subjectEntityId: 'cust-1', campaignId: 'camp-1', runId: 'run-1', actionId: 'step-1',
  trigger: {}, ...over,
} as AutomationContext)

const createForFeature = jest.fn()
const createBatch = jest.fn()
const notificationService = { createForFeature, createBatch }
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
const deps = {
  em: {} as never,
  container: { resolve: () => notificationService } as never,
  logger: logger as never,
  scope,
  now: new Date('2026-09-30T12:00:00.000Z'),
  commandContext: { systemActor: true } as never,
} as never

beforeEach(() => {
  createForFeature.mockReset()
  createBatch.mockReset()
  findOneWithDecryption.mockReset()
  findOneWithDecryption.mockResolvedValue({ displayName: 'Jane Doe' })
})

describe('notify: team audience', () => {
  it('restricts recipients to the run\'s own organization', async () => {
    await notifyStep.execute(ctx(), { audience: 'team', message: 'needs a human' }, deps)
    expect(createForFeature).toHaveBeenCalledTimes(1)
    const [input] = createForFeature.mock.calls[0]
    expect(input).toMatchObject({
      requiredFeature: 'marketing_automation.runs.view',
      restrictRecipientsToOrganization: true,
    })
  })

  it('resolves {{customer.displayName}} in the authored message, not just in the title/body variables', async () => {
    await notifyStep.execute(ctx(), { audience: 'team', message: '{{customer.displayName}} answered 2 on the NPS' }, deps)
    const [input] = createForFeature.mock.calls[0]
    expect(input).toMatchObject({ bodyVariables: { message: 'Jane Doe answered 2 on the NPS' } })
  })
})
