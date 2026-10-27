import type { EntityManager } from '@mikro-orm/postgresql'
import { Code } from '../data/entities'
import type { PromotionsCodeScope } from '../lib/code-service'
import { getPromotionsQueue, PROMOTIONS_CODE_GENERATE_QUEUE } from '../lib/queues'

// SPEC-055 §Implementation Plan Phase 3 Step 6 / §Release 4 Contract Freeze (Release 4
// PLAN.md Step 6.4). This file is `promotions`' own `services/code-generation.ts` named
// by the spec's Implementation Plan — the frozen `promotionCodeGenerationService` DI
// token. `api/codes/route.ts`'s `POST` action (for a newly-created dynamic code) and
// `api/codes/[id]/generate/route.ts` both call `triggerGeneration`; the actual batch
// generation runs in `workers/code-generation.worker.ts`, which this service only enqueues
// a job for — it never generates codes itself (kept off the request thread, per the
// spec's own Problem Statement: "Generating thousands of unique codes is CPU-bound; must
// not block request threads").
//
// Progress-tracking decision (documented per this step's own instructions): this module
// does NOT create a `ProgressJob` for code generation. `Code.generated`/`Code.amount` are
// already persistent, tenant/org-scoped counters on the row the admin UI already reads
// (`GET /api/promotions/codes`, `GET /api/promotions/codes/[id]/generated`) — adding a
// parallel `ProgressJob` would duplicate that state for a feature that already has a
// built-in, cheap-to-read counter, with no new capability gained. `getGenerationStatus`
// below is the smallest conservative addition: a thin, no-new-storage read helper the
// admin UI (Step 6.6) can poll, not progress-module integration.

export type CodeGenerationJobPayload = {
  codeId: string
  tenantId: string
  organizationId: string
}

export type TriggerGenerationResult = { jobId: string }

export type CodeGenerationStatus = {
  codeId: string
  amount: number | null
  generated: number
  complete: boolean
}

export class PromotionCodeGenerationService {
  /**
   * Enqueues a `promotions-code-generate` job for the worker to pick up; returns the
   * queue's own job id (the `{ jobId }` the spec's `POST /codes/[id]/generate` response
   * carries).
   */
  async triggerGeneration(codeId: string, scope: PromotionsCodeScope): Promise<TriggerGenerationResult> {
    const queue = getPromotionsQueue<CodeGenerationJobPayload>(PROMOTIONS_CODE_GENERATE_QUEUE)
    const jobId = await queue.enqueue({ codeId, tenantId: scope.tenantId, organizationId: scope.organizationId })
    return { jobId }
  }

  /** Cheap read of the `Code` row's own counters — see the progress-tracking decision above. */
  async getGenerationStatus(
    em: EntityManager,
    codeId: string,
    scope: PromotionsCodeScope,
  ): Promise<CodeGenerationStatus | null> {
    const code = await em.findOne(Code, {
      id: codeId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!code) return null
    const amount = code.amount ?? null
    return {
      codeId: code.id,
      amount,
      generated: code.generated,
      complete: amount != null ? code.generated >= amount : true,
    }
  }
}
