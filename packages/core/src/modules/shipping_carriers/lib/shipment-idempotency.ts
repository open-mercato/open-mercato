import { createHash } from 'node:crypto'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CarrierShipmentIdempotencyKey } from '../data/entities'

type Scope = { organizationId: string; tenantId: string }

// Use Symbol.for so the marker survives module duplication across bundle boundaries — an
// `instanceof` check returns false when the API route and the service load separate copies of
// this class in the production build, which would silently downgrade the 409 conflict to a 502.
const SHIPMENT_IDEMPOTENCY_CONFLICT_MARKER = Symbol.for('@open-mercato/ShipmentIdempotencyConflictError')

export class ShipmentIdempotencyConflictError extends Error {
  readonly [SHIPMENT_IDEMPOTENCY_CONFLICT_MARKER] = true
  readonly idempotencyKey: string
  constructor(idempotencyKey: string) {
    super(`[internal] Shipment idempotency conflict for key "${idempotencyKey}"`)
    this.name = 'ShipmentIdempotencyConflictError'
    this.idempotencyKey = idempotencyKey
  }
}

export function isShipmentIdempotencyConflictError(error: unknown): error is ShipmentIdempotencyConflictError {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as Record<symbol, unknown>)[SHIPMENT_IDEMPOTENCY_CONFLICT_MARKER] === true
  )
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(',')}}`
}

/**
 * Deterministic fingerprint of a shipment-create request so that reusing the same
 * idempotency key with a conflicting payload can be detected. Key order is
 * normalized and `undefined` values are dropped so semantically equal requests
 * hash identically.
 */
export function computeShipmentRequestHash(fingerprint: unknown): string {
  return createHash('sha256').update(stableSerialize(fingerprint)).digest('hex')
}

export async function findShipmentIdempotencyClaim(
  em: EntityManager,
  idempotencyKey: string,
  providerKey: string,
  scope: Scope,
): Promise<CarrierShipmentIdempotencyKey | null> {
  return findOneWithDecryption(
    em,
    CarrierShipmentIdempotencyKey,
    {
      idempotencyKey,
      providerKey,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    undefined,
    scope,
  )
}

/**
 * Atomically claims an idempotency key by inserting the dedup row. Returns the
 * managed claim on success, or `null` when a concurrent request already inserted
 * the same scoped key (the unique constraint fires), mirroring the webhook-event
 * claim idiom.
 */
export async function claimShipmentIdempotency(
  em: EntityManager,
  idempotencyKey: string,
  providerKey: string,
  requestHash: string,
  scope: Scope,
): Promise<CarrierShipmentIdempotencyKey | null> {
  const record = em.create(CarrierShipmentIdempotencyKey, {
    idempotencyKey,
    providerKey,
    requestHash,
    shipmentId: null,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  try {
    await em.persist(record).flush()
    return record
  } catch (error: unknown) {
    if (error instanceof UniqueConstraintViolationException) return null
    throw error
  }
}

export async function resolveShipmentIdempotency(
  em: EntityManager,
  claim: CarrierShipmentIdempotencyKey,
  shipmentId: string,
): Promise<void> {
  claim.shipmentId = shipmentId
  await em.flush()
}

export async function releaseShipmentIdempotency(
  em: EntityManager,
  idempotencyKey: string,
  providerKey: string,
  scope: Scope,
): Promise<void> {
  const existing = await findShipmentIdempotencyClaim(em, idempotencyKey, providerKey, scope)
  if (!existing) return
  await em.remove(existing).flush()
}
