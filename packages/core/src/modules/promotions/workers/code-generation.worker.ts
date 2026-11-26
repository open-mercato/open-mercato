import { randomInt } from 'crypto'
import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { Code, GeneratedCode } from '../data/entities'
import { MAX_DYNAMIC_CODE_POOL_AMOUNT } from '../data/validators'
import { resolveCodeByString, type PromotionsCodeScope } from '../lib/code-service'
import { PROMOTIONS_CODE_GENERATE_QUEUE } from '../lib/queues'
import { emitPromotionsEvent } from '../events'
import type { CodeGenerationJobPayload } from '../services/code-generation'

// SPEC-055 §Implementation Plan Phase 3 Step 5 / §Operational Risks "Dynamic Code
// Generation Stall" (Release 4 PLAN.md Step 6.4). Triggered on-demand by
// `services/code-generation.ts#triggerGeneration` (from `api/codes/route.ts`'s `POST`
// action for a new dynamic code, and from `api/codes/[id]/generate/route.ts`) — this
// worker has no scheduler registration of its own, unlike `cart`'s sweepers.

const logger = createLogger('promotions').child({ component: 'code-generation-worker' })

export const metadata: WorkerMeta = {
  queue: PROMOTIONS_CODE_GENERATE_QUEUE,
  id: 'promotions:code-generation',
  concurrency: 2,
}

// Charset design decision (documented per this step's own instructions): uppercase
// alphanumeric, excluding `0`/`O`/`1`/`I`/`L` — the characters most often confused with
// each other when a human reads or re-types a voucher code aloud or from a screenshot.
// A defensible, common choice for human-typed codes; not mandated by the spec.
const CODE_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const DEFAULT_CODE_BODY_LENGTH = 8
// Batch-insert chunk size (§Problem Statement: "must not block request threads" — this
// worker already runs off the request thread; chunking here bounds how much is held
// in memory and flushed per round trip for a single generation run, not a request-latency
// concern).
const BATCH_SIZE = 500
// Collision-retry budget per candidate before giving up. With this charset/length space
// (32^8 for the default length) a genuine collision is astronomically unlikely outside a
// deliberately-forced test scenario — this bound exists so a pathological config (e.g. a
// 1-character body with a huge target amount) fails loudly instead of spinning forever.
const MAX_COLLISION_RETRIES = 25

function randomCodeBody(length: number): string {
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += CODE_CHARSET[randomInt(CODE_CHARSET.length)]
  }
  return out
}

function buildCandidate(code: Code): string {
  const length = code.length && code.length > 0 ? code.length : DEFAULT_CODE_BODY_LENGTH
  return `${code.prefix ?? ''}${randomCodeBody(length)}${code.suffix ?? ''}`
}

/**
 * Mints one unique candidate string: checked against both the in-process set of codes
 * already minted THIS run (covers unflushed rows the DB cannot see yet) and the shared
 * `Code.code`/`GeneratedCode.code` namespace (W5d) via the SAME `resolveCodeByString`
 * collision check `lib/code-service.ts#resolveCodeByString` uses for the reserve/use
 * path — so this worker and that service can never independently drift on what
 * "collision" means.
 */
async function mintUniqueCandidate(
  em: EntityManager,
  code: Code,
  scope: PromotionsCodeScope,
  localGenerated: Set<string>,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt += 1) {
    const candidate = buildCandidate(code)
    if (localGenerated.has(candidate)) continue
    const existing = await resolveCodeByString(em, candidate, scope)
    if (existing) continue
    return candidate
  }
  throw new Error(`[internal] promotions code generation exhausted collision retries for code ${code.id}`)
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }

type GenerationRunResult = { codeId: string; amount: number; actualCountAfter: number; complete: boolean }

export default async function handle(
  job: QueuedJob<CodeGenerationJobPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const payload = (job?.payload ?? {}) as CodeGenerationJobPayload
  const { codeId, tenantId, organizationId } = payload
  if (!codeId || !tenantId || !organizationId) {
    logger.warn('promotions:code-generation skipping job — payload is missing identity fields', { payload })
    return
  }

  const em = (ctx.resolve('em') as EntityManager).fork()
  const scope: PromotionsCodeScope = { tenantId, organizationId }

  let completedRun: GenerationRunResult | null = null
  while (!completedRun) {
    // Each batch has a short transaction and its own row lock. A concurrent job
    // re-counts after acquiring that lock, so it cannot overfill the same pool.
    const run = await em.transactional(async (tem): Promise<GenerationRunResult | null> => {
      const lockedCode = await tem.findOne(
        Code,
        { id: codeId, tenantId, organizationId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      )
      if (!lockedCode) {
        logger.warn('promotions:code-generation code not found (deleted or wrong tenant/org)', { codeId, tenantId, organizationId })
        return null
      }
      if (lockedCode.type !== 'dynamic' || !lockedCode.amount) {
        logger.warn('promotions:code-generation code is not a dynamic pool with a target amount — nothing to generate', {
          codeId,
          type: lockedCode.type,
          amount: lockedCode.amount,
        })
        return null
      }
      if (lockedCode.amount > MAX_DYNAMIC_CODE_POOL_AMOUNT) {
        logger.warn('promotions:code-generation pool exceeds the configured maximum — nothing to generate', {
          codeId,
          amount: lockedCode.amount,
          maximum: MAX_DYNAMIC_CODE_POOL_AMOUNT,
        })
        return null
      }

      // The generated-code rows, not Code.generated, are authoritative after a
      // restart or a partially completed prior job.
      const actualCountBefore = await tem.count(GeneratedCode, { codeId: lockedCode.id, tenantId, organizationId })
      const batchSize = Math.min(BATCH_SIZE, Math.max(0, lockedCode.amount - actualCountBefore))
      const localGenerated = new Set<string>()

      for (let index = 0; index < batchSize; index += 1) {
        const candidate = await mintUniqueCandidate(tem, lockedCode, scope, localGenerated)
        localGenerated.add(candidate)
        tem.persist(
          tem.create(GeneratedCode, {
            codeId: lockedCode.id,
            organizationId,
            tenantId,
            code: candidate,
            active: true,
          }),
        )
      }

      if (batchSize > 0) await tem.flush()
      const actualCountAfter = batchSize > 0
        ? await tem.count(GeneratedCode, { codeId: lockedCode.id, tenantId, organizationId })
        : actualCountBefore
      lockedCode.generated = actualCountAfter
      await tem.flush()
      return {
        codeId: lockedCode.id,
        amount: lockedCode.amount,
        actualCountAfter,
        complete: actualCountAfter >= lockedCode.amount,
      }
    })

    if (!run) return
    // Discard managed rows between batches. Each prior batch and its counter
    // reconciliation have already committed before the next transaction begins.
    em.clear()
    if (run.complete) completedRun = run
  }
  const { codeId: completedCodeId, amount, actualCountAfter } = completedRun

  // The CRUD list cache (ENABLE_CRUD_API_CACHE) never invalidates on its own for a
  // worker-side write — without this the admin UI's generated-codes counter can stay
  // stale at its pre-reconcile value indefinitely (no TTL on the cache entry). Invalidated
  // after the transaction commits, never inside it.
  const cacheContainer = { resolve: ctx.resolve } as unknown as AwilixContainer
  await invalidateCrudCache(
    cacheContainer,
    'promotions.code',
    { id: completedCodeId, organizationId, tenantId },
    tenantId,
    'promotions.code.generated.reconcile',
  )

  try {
    await emitPromotionsEvent(
      'promotions.generated_code.created',
      { codeId: completedCodeId, tenantId, organizationId, generated: actualCountAfter, amount },
      { persistent: true },
    )
  } catch (err) {
    logger.warn('[internal] promotions.generated_code.created emit failed', { codeId, err })
  }
}
