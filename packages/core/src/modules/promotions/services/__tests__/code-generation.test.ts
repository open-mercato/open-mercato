// Release 4 PLAN.md Step 6.4 — unit coverage for `services/code-generation.ts`. Mocks
// `lib/queues.ts`'s `getPromotionsQueue` so `triggerGeneration` is tested as a thin
// enqueue wrapper, without touching the real local/BullMQ queue strategy (same spirit as
// `commands/__tests__/codes.test.ts`'s fake `promotionCodeService`).

import { randomUUID } from 'crypto'
import type { PromotionsCodeScope } from '../../lib/code-service'

jest.mock('../../lib/queues', () => ({
  PROMOTIONS_CODE_GENERATE_QUEUE: 'promotions-code-generate',
  getPromotionsQueue: jest.fn(),
}))

import { getPromotionsQueue } from '../../lib/queues'
import { PromotionCodeGenerationService } from '../code-generation'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const SCOPE: PromotionsCodeScope = { tenantId: TENANT, organizationId: ORG }

describe('PromotionCodeGenerationService.triggerGeneration', () => {
  afterEach(() => jest.clearAllMocks())

  it('enqueues onto the promotions-code-generate queue with the codeId and scope, returning the queue job id', async () => {
    const enqueue = jest.fn(async () => 'queue-job-1')
    ;(getPromotionsQueue as jest.Mock).mockReturnValue({ enqueue })
    const service = new PromotionCodeGenerationService()

    const result = await service.triggerGeneration('code-1', SCOPE)

    expect(result).toEqual({ jobId: 'queue-job-1' })
    expect(enqueue).toHaveBeenCalledWith({ codeId: 'code-1', tenantId: TENANT, organizationId: ORG })
  })
})

describe('PromotionCodeGenerationService.getGenerationStatus', () => {
  function fakeEm(code: Record<string, unknown> | null) {
    return { findOne: async () => code } as unknown as import('@mikro-orm/postgresql').EntityManager
  }

  it('returns null when the code does not exist (or is not visible to the scope)', async () => {
    const service = new PromotionCodeGenerationService()
    const result = await service.getGenerationStatus(fakeEm(null), 'no-such-code', SCOPE)
    expect(result).toBeNull()
  })

  it('reports complete: false while generated is behind amount', async () => {
    const service = new PromotionCodeGenerationService()
    const code = { id: randomUUID(), amount: 100, generated: 40 }
    const result = await service.getGenerationStatus(fakeEm(code), code.id, SCOPE)
    expect(result).toEqual({ codeId: code.id, amount: 100, generated: 40, complete: false })
  })

  it('reports complete: true once generated reaches amount', async () => {
    const service = new PromotionCodeGenerationService()
    const code = { id: randomUUID(), amount: 100, generated: 100 }
    const result = await service.getGenerationStatus(fakeEm(code), code.id, SCOPE)
    expect(result?.complete).toBe(true)
  })

  it('treats a null amount (no target set) as complete', async () => {
    const service = new PromotionCodeGenerationService()
    const code = { id: randomUUID(), amount: null, generated: 0 }
    const result = await service.getGenerationStatus(fakeEm(code), code.id, SCOPE)
    expect(result).toEqual({ codeId: code.id, amount: null, generated: 0, complete: true })
  })
})
