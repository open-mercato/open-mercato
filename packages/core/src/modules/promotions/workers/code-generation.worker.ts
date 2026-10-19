import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { Code, GeneratedCode } from '../data/entities'
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
    out += CODE_CHARSET[Math.floor(Math.random() * CODE_CHARSET.length)]
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

type GenerationRunResult = { code: Code; actualCountAfter: number }

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

  // The whole read-count-mint-reconcile run happens under one row lock, held for the
  // duration of the transaction: the queue runs this worker with concurrency 2
  // (`lib/queues.ts`), and two concurrent generation jobs for the same pool (e.g. a
  // manual "Generate" click racing the auto-trigger) would otherwise both read the same
  // unlocked `remaining` and each insert a full batch, overfilling the pool to 2x `amount`.
  //
  // The result is returned from the transactional callback rather than assigned to an
  // outer `let` — TypeScript's control-flow narrowing cannot see an assignment made
  // inside a nested closure, so `if (!code) return` below would otherwise narrow `code`
  // to `never` for the rest of the function (a real TS2339 the CI build caught).
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

    // §Operational Risks "Dynamic Code Generation Stall": idempotent on restart — the
    // authoritative generated count is a fresh COUNT(*) against
    // `promotion_generated_codes`, never the possibly-stale `Code.generated` counter. This
    // also makes an at-least-once queue redelivery of an already-finished job a safe no-op.
    const actualCountBefore = await tem.count(GeneratedCode, { codeId: lockedCode.id, tenantId, organizationId })
    let remaining = Math.max(0, lockedCode.amount - actualCountBefore)

    if (remaining > 0) {
      const localGenerated = new Set<string>()
      let batch: GeneratedCode[] = []

      while (remaining > 0) {
        const candidate = await mintUniqueCandidate(tem, lockedCode, scope, localGenerated)
        localGenerated.add(candidate)

        batch.push(
          tem.create(GeneratedCode, {
            codeId: lockedCode.id,
            organizationId,
            tenantId,
            code: candidate,
            active: true,
          }),
        )
        remaining -= 1

        if (batch.length >= BATCH_SIZE || remaining === 0) {
          for (const generated of batch) tem.persist(generated)
          await tem.flush()
          batch = []
        }
      }
    }

    // `Code.generated` is reconciled to the ACTUAL count on completion, never incremented
    // speculatively per insert (§Operational Risks) — re-counted fresh here too, so a
    // concurrent writer touching the same code between the loop and this point still
    // leaves the counter correct.
    const actualCountAfter = await tem.count(GeneratedCode, { codeId: lockedCode.id, tenantId, organizationId })
    lockedCode.generated = actualCountAfter
    await tem.flush()
    return { code: lockedCode, actualCountAfter }
  })

  if (!run) return
  const { code, actualCountAfter } = run

  // The CRUD list cache (ENABLE_CRUD_API_CACHE) never invalidates on its own for a
  // worker-side write — without this the admin UI's generated-codes counter can stay
  // stale at its pre-reconcile value indefinitely (no TTL on the cache entry). Invalidated
  // after the transaction commits, never inside it.
  const cacheContainer = { resolve: ctx.resolve } as unknown as AwilixContainer
  await invalidateCrudCache(
    cacheContainer,
    'promotions.code',
    { id: code.id, organizationId, tenantId },
    tenantId,
    'promotions.code.generated.reconcile',
  )

  try {
    await emitPromotionsEvent(
      'promotions.generated_code.created',
      { codeId: code.id, tenantId, organizationId, generated: actualCountAfter, amount: code.amount },
      { persistent: true },
    )
  } catch (err) {
    logger.warn('[internal] promotions.generated_code.created emit failed', { codeId, err })
  }
}
