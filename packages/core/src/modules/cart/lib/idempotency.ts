import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { CartIdempotencyKey } from '../data/entities'

// Step 4.7 — §8.2: "Mutations accept an `Idempotency-Key`. A repeated key within
// the cart's lifetime returns the original result without re-applying ... Keys are
// stored per cart with the resulting `updatedAt` and a response digest. A key
// replayed with a different body returns `422 idempotency_key_mismatch`."
//
// `CartIdempotencyKey` (Step 4.2, `data/entities.ts`) is `@Unique(['cartId', 'key'])`
// with a required (non-nullable) `cartId` FK — it is designed to scope a key to an
// ALREADY-EXISTING cart. That is why this helper only wires into the line-mutation
// routes (`cart.lines.add`/`.bulkAdd`): `cart.create` has no `cartId` to scope a row
// to until the create itself has already happened, and inventing a nullable
// `cartId` on this entity to support it was explicitly out of scope for this step
// ("design it minimally from the entity's actual columns — don't invent columns").
// See `api/current/route.ts`'s own note for where this is applied.

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key'
export const IDEMPOTENCY_KEY_MISMATCH_CODE = 'idempotency_key_mismatch'

export function readIdempotencyKey(request: Request): string | null {
  const value = request.headers.get(IDEMPOTENCY_KEY_HEADER)
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Canonicalizes (stable key order) before hashing, so cosmetic JSON differences — key order, whitespace — never cause a false `idempotency_key_mismatch`. Mirrors `commands/lines.ts`'s own `canonicalJson` (not exported there, so duplicated here at the same, small scope). */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function computeRequestDigest(body: unknown): string {
  return createHash('sha256').update(canonicalize(body)).digest('hex')
}

export type IdempotencyScope = { tenantId: string; organizationId: string }

export type IdempotencyReplay = { status: number; body: unknown }

/**
 * Looks up a previously stored response for `(cartId, key)`. Returns `null` when
 * this key has never been seen for this cart (the caller should proceed with the
 * mutation); throws the standardized `422 idempotency_key_mismatch` when the SAME
 * key arrives with a DIFFERENT request body (§8.2).
 */
export async function findIdempotencyReplay(
  em: EntityManager,
  scope: IdempotencyScope,
  cartId: string,
  key: string,
  requestDigest: string,
): Promise<IdempotencyReplay | null> {
  const existing = await em.findOne(CartIdempotencyKey, {
    cartId,
    key,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!existing) return null
  if (existing.requestDigest !== requestDigest) {
    throw new CrudHttpError(422, {
      error: `[internal] ${IDEMPOTENCY_KEY_MISMATCH_CODE}`,
      code: IDEMPOTENCY_KEY_MISMATCH_CODE,
    })
  }
  return { status: existing.responseStatus, body: existing.responseBody }
}

/**
 * Persists the response for a freshly-executed mutation so a replay of the same
 * key returns it verbatim instead of re-running the command.
 *
 * Best-effort against the concurrent-first-request race: §8.2 does not specify a
 * lock, and the smallest correct design here accepts that a loser of the unique
 * `(cartId, key)` constraint has already had its OWN mutation committed
 * successfully (the command ran before this is called) — it just re-reads the
 * winner's row rather than erroring a caller whose write already succeeded.
 */
export async function recordIdempotencyResponse(
  em: EntityManager,
  scope: IdempotencyScope,
  cartId: string,
  key: string,
  requestDigest: string,
  status: number,
  body: unknown,
): Promise<void> {
  try {
    const row = em.create(CartIdempotencyKey, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      cartId,
      key,
      requestDigest,
      responseStatus: status,
      responseBody: body,
    })
    em.persist(row)
    await em.flush()
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
  }
}
