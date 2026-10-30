/**
 * Release 5 Phase 3 reservation lifecycle (Step 2.2).
 *
 * @see .ai/specs/2026-08-14-availability-contract.md §4.1/§4.1b/§4.4
 * @see .ai/specs/analysis/ANALYSIS-2026-10-26-availability-release-5.md A1/A6/A7/A14/A15
 *
 * `reserveAvailability`/`releaseAvailability`/`commitAvailability` are the THIS-STEP
 * implementation of the spec's `lib/reservationCommands.ts` (§4.1's own file path). Step
 * 2.1 already declared the narrower, persisted-snapshot types
 * (`AvailabilityReservationSourceType`/`Status`/`LineOutcome`/`ItemSnapshot`) next to the
 * `AvailabilityReservation` entity in `../data/entities.ts` — imported below, not
 * redeclared. The richer `AvailabilityReservationLine` (adding `key`/`available`) is this
 * file's own addition, narrowed down to the entity's snapshot shape before persisting.
 *
 * DI note: the spec's §4.1 code block shows these functions taking only `input` (no
 * container). Every sibling Release 5 service in this codebase
 * (`wmsReservationService`, `customerCreditService`, `policyResolutionService`) instead
 * takes its resolved dependencies explicitly, so tests can inject fakes without a real
 * DI container — this file follows THAT precedent and takes the resolver container as an
 * explicit first argument. The thin `commands/reservations.ts` wrappers (which DO have a
 * `CommandRuntimeContext`, container included) are the public, spec-literal call shape.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { buildTrustedCommandContext } from '@open-mercato/shared/lib/commands/trusted-context'
import { CrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { availabilityItemKey } from '@open-mercato/shared/lib/availability'
import {
  AvailabilityReservation,
  type AvailabilityReservationItemSnapshot,
  type AvailabilityReservationLineOutcome,
  type AvailabilityReservationStatus,
} from '../data/entities'
import {
  availabilityCommitInputSchema,
  availabilityReleaseInputSchema,
  availabilityReserveInputSchema,
  type AvailabilityCommitInput,
  type AvailabilityReleaseInput,
  type AvailabilityReserveInput,
} from '../data/validators'
import { tryResolve } from './tryResolve'
import { emitAvailabilityEvent } from '../events'
import type { PolicyResolutionService, ResolvedAvailabilityPolicy } from './policyResolution'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

export type Resolver = { resolve: <T = unknown>(name: string) => T }

export type ReservationScope = { tenantId: string; organizationId: string }

export type AvailabilityShortfallLine = {
  catalogProductId: string
  catalogVariantId: string | null
  requested: number
  available: number
}

export type AvailabilityReservationLine = {
  key: string
  catalogProductId: string
  catalogVariantId: string | null
  requested: number
  outcome: AvailabilityReservationLineOutcome
  heldQuantity: number
  backorderQuantity: number
  available: number | null
}

export type ReserveAvailabilityResult = {
  reserved: boolean
  reservationId: string | null
  status: AvailabilityReservationStatus | null
  expiresAt: string | null
  lines: AvailabilityReservationLine[]
  shortfall: AvailabilityShortfallLine[]
}

export type ReleaseAvailabilityResult = {
  reservationId: string | null
  status: AvailabilityReservationStatus | 'not_found'
  released: boolean
}

export type CommitAvailabilityResult = {
  reservationId: string
  status: 'committed' | 'recovered' | 'stock_lost'
  shortfall: AvailabilityShortfallLine[]
}

// ---------------------------------------------------------------------------
// wms soft-resolve duck types (`packages/core/AGENTS.md` → Cross-Module Coupling). Never a
// static import of `wms` entities/types — only the `wmsReservationService` methods this
// file actually calls.
// ---------------------------------------------------------------------------

export type WmsSideEffectsLike = {
  reservations?: Array<{ entity: unknown; action: 'created' | 'updated' }>
  balances?: Array<{ entity: unknown; action: 'updated' }>
}

// Step 2.3's own `availability_reservations`-vs-`wms_inventory_reservations` row shape — just
// enough fields for the expiry/reconciliation jobs (`lib/reservationSweep.ts`) to read a wms
// row's own status/sourceType without a static `wms` entity import (duck typing, same
// cross-module rule `WmsReservationServiceLike` below already follows).
export type WmsReservationRowLike = {
  id: string
  tenantId: string
  organizationId: string
  sourceType: string
  status: string
}

type GateLineInput = {
  key: string
  catalogProductId: string
  catalogVariantId: string
  quantity: number
  mode: 'exact' | 'up_to_sellable'
}

type GateLineResult = { key: string; sellable: number; heldQuantity: number; reservationIds: string[] }
type GateShortfallLine = { key: string; requested: number; sellable: number }

type ReserveLinesForCheckoutResultLike =
  | { ok: true; lines: GateLineResult[]; sideEffects: WmsSideEffectsLike }
  | { ok: false; lines: GateShortfallLine[] }

export type WmsReservationServiceLike = {
  reserveLinesForCheckout(
    trx: EntityManager,
    ctx: CommandRuntimeContext,
    input: {
      scope: ReservationScope
      lines: GateLineInput[]
      sourceType: 'checkout' | 'order'
      sourceId: string
      expiresAt: Date | null
      warehouseIds?: string[] | null
    },
  ): Promise<ReserveLinesForCheckoutResultLike>
  releaseInTransaction(
    trx: EntityManager,
    ctx: CommandRuntimeContext,
    input: { tenantId: string; organizationId: string; reservationId: string; reason: string },
  ): Promise<{ reservationEntity: unknown; touchedBalances: unknown[] }>
  convertInTransaction(
    trx: EntityManager,
    ctx: CommandRuntimeContext,
    input: { tenantId: string; organizationId: string; reservationId: string; sourceType: 'order'; sourceId: string },
  ): Promise<{ reservationId: string; reservationEntity: unknown }>
  emitSideEffects(ctx: CommandRuntimeContext, sideEffects: WmsSideEffectsLike): Promise<void>
  // Step 2.3 (A12). Scoped-by-id read, used by the reconciliation job to check whether a
  // hold's own `wmsReservationIds` rows are still `active`/`checkout` (drift a/c) — never a
  // mutation, so no side effects to replicate.
  findReservationsByIds(
    trx: EntityManager,
    ctx: CommandRuntimeContext,
    input: { tenantId: string; organizationId: string; ids: string[] },
  ): Promise<WmsReservationRowLike[]>
  // Step 2.3 (A12, drift b). Cross-organization, tenant-scoped listing of active `wms` rows
  // of one `sourceType` — the ONLY tenant-wide (no single-organization) read on this
  // duck-typed surface, matching the hourly job's own `{ tenantId }`-only scope (§10,
  // D-R5-32). Tenant isolation is enforced by the `WHERE tenant_id = …` filter itself, the
  // same filter-based (not assertion-based) boundary `cart`'s own tenant-scoped sweepers use.
  listActiveReservationsBySourceType(
    trx: EntityManager,
    input: { tenantId: string; sourceType: string; createdBefore: Date; cursor?: string | null; limit: number },
  ): Promise<WmsReservationRowLike[]>
}

export function tryResolveWmsService(container: Resolver): WmsReservationServiceLike | undefined {
  return tryResolve<WmsReservationServiceLike>(container, 'wmsReservationService')
}

function tryResolvePolicyService(container: Resolver): PolicyResolutionService | undefined {
  return tryResolve<PolicyResolutionService>(container, 'policyResolutionService')
}

export function buildServiceCtx(container: Resolver, scope: ReservationScope, reason: string): CommandRuntimeContext {
  const { ctx } = buildTrustedCommandContext({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    actorType: 'system',
    reason,
  })
  return { ...ctx, container: container as unknown as CommandRuntimeContext['container'] }
}

export function mergeSideEffects(a: WmsSideEffectsLike, b: WmsSideEffectsLike): WmsSideEffectsLike {
  return {
    reservations: [...(a.reservations ?? []), ...(b.reservations ?? [])],
    balances: [...(a.balances ?? []), ...(b.balances ?? [])],
  }
}

// ---------------------------------------------------------------------------
// Per-line classification (D-R5-9, the §4.1 outcome table)
// ---------------------------------------------------------------------------

type NormalizedItem = { catalogProductId: string; catalogVariantId: string | null; quantity: number }

type ClassifiedLine = {
  key: string
  catalogProductId: string
  catalogVariantId: string | null
  requested: number
  kind: 'not_tracked' | 'preorder' | 'missing_variant' | 'gate'
  allowBackorder: boolean
}

function classifyLine(
  item: NormalizedItem,
  policy: ResolvedAvailabilityPolicy,
  wmsAvailable: boolean,
  now: Date,
): ClassifiedLine {
  const key = availabilityItemKey(item)
  const base = {
    key,
    catalogProductId: item.catalogProductId,
    catalogVariantId: item.catalogVariantId,
    requested: item.quantity,
  }
  if (!wmsAvailable || !policy.isStockManaged.value) {
    return { ...base, kind: 'not_tracked', allowBackorder: false }
  }
  if (policy.preorderReleaseAt.value && policy.preorderReleaseAt.value.getTime() > now.getTime()) {
    return { ...base, kind: 'preorder', allowBackorder: false }
  }
  if (!item.catalogVariantId) {
    return { ...base, kind: 'missing_variant', allowBackorder: false }
  }
  return { ...base, kind: 'gate', allowBackorder: policy.allowBackorder.value }
}

function toGateLine(line: ClassifiedLine): GateLineInput {
  return {
    key: line.key,
    catalogProductId: line.catalogProductId,
    catalogVariantId: line.catalogVariantId as string,
    quantity: line.requested,
    mode: line.allowBackorder ? 'up_to_sellable' : 'exact',
  }
}

function finalizeNoGateLine(line: ClassifiedLine): AvailabilityReservationLine {
  // Only reachable for 'not_tracked'/'preorder' — 'missing_variant' short-circuits the
  // whole call before this point, and 'gate' lines go through `finalizeGateLine` instead.
  return {
    key: line.key,
    catalogProductId: line.catalogProductId,
    catalogVariantId: line.catalogVariantId,
    requested: line.requested,
    outcome: line.kind as 'not_tracked' | 'preorder',
    heldQuantity: 0,
    backorderQuantity: 0,
    available: null,
  }
}

function finalizeGateLine(line: ClassifiedLine, gateByKey: Map<string, GateLineResult>): AvailabilityReservationLine {
  const gate = gateByKey.get(line.key)
  const heldQuantity = gate?.heldQuantity ?? 0
  const outcome: AvailabilityReservationLineOutcome = heldQuantity >= line.requested ? 'held' : 'backorder'
  return {
    key: line.key,
    catalogProductId: line.catalogProductId,
    catalogVariantId: line.catalogVariantId,
    requested: line.requested,
    outcome,
    heldQuantity,
    backorderQuantity: outcome === 'backorder' ? line.requested - heldQuantity : 0,
    available: gate?.sellable ?? null,
  }
}

// On an all-or-nothing failure every line reports `heldQuantity: 0` (§4.1). Lines that
// themselves shortfalled report `outcome: 'shortfall'`; every other line keeps its own
// classification (nothing changes for a line that was never going to hold anything
// anyway) or, for a gate line that would otherwise have held/backordered, keeps that
// speculative outcome with nothing actually held — the whole call wrote nothing.
function zeroLine(line: ClassifiedLine, shortfallByKey: Map<string, GateShortfallLine>): AvailabilityReservationLine {
  if (line.kind === 'not_tracked' || line.kind === 'preorder') return finalizeNoGateLine(line)
  const shortfall = shortfallByKey.get(line.key)
  if (line.kind === 'missing_variant' || shortfall) {
    return {
      key: line.key,
      catalogProductId: line.catalogProductId,
      catalogVariantId: line.catalogVariantId,
      requested: line.requested,
      outcome: 'shortfall',
      heldQuantity: 0,
      backorderQuantity: 0,
      available: shortfall?.sellable ?? 0,
    }
  }
  return {
    key: line.key,
    catalogProductId: line.catalogProductId,
    catalogVariantId: line.catalogVariantId,
    requested: line.requested,
    outcome: line.allowBackorder ? 'backorder' : 'held',
    heldQuantity: 0,
    backorderQuantity: 0,
    available: null,
  }
}

function toItemSnapshot(line: AvailabilityReservationLine): AvailabilityReservationItemSnapshot {
  return {
    catalogProductId: line.catalogProductId,
    catalogVariantId: line.catalogVariantId,
    requested: line.requested,
    outcome: line.outcome,
    heldQuantity: line.heldQuantity,
    backorderQuantity: line.backorderQuantity,
  }
}

function itemsMatch(stored: AvailabilityReservationItemSnapshot[], items: NormalizedItem[]): boolean {
  if (stored.length !== items.length) return false
  const byKey = new Map(
    stored.map((item) => [availabilityItemKey({ catalogProductId: item.catalogProductId, catalogVariantId: item.catalogVariantId }), item]),
  )
  return items.every((item) => {
    const stored = byKey.get(availabilityItemKey(item))
    return !!stored && stored.requested === item.quantity
  })
}

function replayOrThrowMismatch(
  existing: AvailabilityReservation,
  sourceId: string,
  items: NormalizedItem[],
): ReserveAvailabilityResult {
  const sameSource = existing.sourceType === 'checkout' && existing.sourceId === sourceId
  if (!sameSource || !itemsMatch(existing.items, items)) {
    throw new CrudHttpError(409, { error: 'idempotency_key_mismatch' })
  }
  const lines: AvailabilityReservationLine[] = existing.items.map((item) => ({
    key: availabilityItemKey({ catalogProductId: item.catalogProductId, catalogVariantId: item.catalogVariantId }),
    catalogProductId: item.catalogProductId,
    catalogVariantId: item.catalogVariantId,
    requested: item.requested,
    outcome: item.outcome,
    heldQuantity: item.heldQuantity,
    backorderQuantity: item.backorderQuantity,
    available: null,
  }))
  return {
    reserved: true,
    reservationId: existing.id,
    status: existing.status,
    expiresAt: existing.expiresAt ? existing.expiresAt.toISOString() : null,
    lines,
    shortfall: [],
  }
}

// A rollback-only signal: thrown INSIDE the transaction when the gate reports a shortfall,
// so nothing the transaction wrote (the hold row never even got created) survives, then
// caught just outside to build the public shortfall response. Never crosses this module.
class ReserveShortfallSignal extends Error {
  constructor(readonly shortfall: AvailabilityShortfallLine[]) {
    super('[internal] availability.reserve: all-or-nothing shortfall, rolling back')
  }
}

/**
 * `availability.reserve` (§4.1, A1/A6/A7/A15). One transaction: locks balances through
 * `wmsReservationService.reserveLinesForCheckout`, classifies every line's outcome, and
 * writes the `AvailabilityReservation` hold row — all or nothing.
 */
export async function reserveAvailability(
  container: Resolver,
  rawInput: unknown,
): Promise<ReserveAvailabilityResult> {
  const input: AvailabilityReserveInput = availabilityReserveInputSchema.parse(rawInput)
  const scope: ReservationScope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const em = (container.resolve('em') as EntityManager).fork()
  const normalizedItems: NormalizedItem[] = input.items.map((item) => ({
    catalogProductId: item.catalogProductId,
    catalogVariantId: item.catalogVariantId ?? null,
    quantity: item.quantity,
  }))

  // Fast-path idempotent replay (A15) — before any lock/allocation work.
  const existing = await em.findOne(AvailabilityReservation, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    idempotencyKey: input.idempotencyKey,
  })
  if (existing) return replayOrThrowMismatch(existing, input.sourceId, normalizedItems)

  const policyService = tryResolvePolicyService(container)
  const wmsService = tryResolveWmsService(container)
  const now = new Date()

  const policies = policyService
    ? await policyService.resolveMany(
        em,
        normalizedItems.map((item) => ({
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          storeId: null,
          productId: item.catalogProductId,
          variantId: item.catalogVariantId,
        })),
      )
    : normalizedItems.map(() => OPEN_POLICY_DEFAULT)

  const classified = normalizedItems.map((item, index) => classifyLine(item, policies[index], !!wmsService, now))

  // A stock-managed line without a variant can never be checked against a `wms` balance
  // (balances are per-variant only) — an immediate, unconditional shortfall. Short-circuit
  // before opening any transaction: nothing would be written either way (A1 all-or-nothing).
  const missingVariantLines = classified.filter((line) => line.kind === 'missing_variant')
  if (missingVariantLines.length > 0) {
    const shortfall: AvailabilityShortfallLine[] = missingVariantLines.map((line) => ({
      catalogProductId: line.catalogProductId,
      catalogVariantId: null,
      requested: line.requested,
      available: 0,
    }))
    await emitAvailabilityEvent(
      'availability.shortfall.detected',
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        sourceType: 'checkout',
        sourceId: input.sourceId,
        reason: 'reserve',
        lines: shortfall,
      },
      { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    const shortfallByKey = new Map(shortfall.map((line) => [availabilityItemKey(line), { key: availabilityItemKey(line), requested: line.requested, sellable: 0 }]))
    return {
      reserved: false,
      reservationId: null,
      status: null,
      expiresAt: null,
      lines: classified.map((line) => zeroLine(line, shortfallByKey)),
      shortfall,
    }
  }

  const gateLines = classified.filter((line) => line.kind === 'gate')
  const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000)
  const ctx = buildServiceCtx(container, scope, 'availability.reserve')

  type TxOutcome = { reservationId: string; finalLines: AvailabilityReservationLine[]; sideEffects: WmsSideEffectsLike }
  let outcome: TxOutcome

  try {
    outcome = await em.transactional(async (trx) => {
      let finalLines: AvailabilityReservationLine[]
      let wmsReservationIds: string[] = []
      let sideEffects: WmsSideEffectsLike = {}

      if (gateLines.length === 0 || !wmsService) {
        finalLines = classified.map(finalizeNoGateLine)
      } else {
        const gateResult = await wmsService.reserveLinesForCheckout(trx, ctx, {
          scope,
          lines: gateLines.map(toGateLine),
          sourceType: 'checkout',
          sourceId: input.sourceId,
          expiresAt,
          warehouseIds: input.warehouseIds ?? null,
        })
        if (!gateResult.ok) {
          const shortfall: AvailabilityShortfallLine[] = gateResult.lines.map((line) => {
            const classifiedLine = gateLines.find((g) => g.key === line.key)!
            return {
              catalogProductId: classifiedLine.catalogProductId,
              catalogVariantId: classifiedLine.catalogVariantId,
              requested: line.requested,
              available: line.sellable,
            }
          })
          throw new ReserveShortfallSignal(shortfall)
        }
        const gateByKey = new Map(gateResult.lines.map((line) => [line.key, line]))
        finalLines = classified.map((line) => (line.kind === 'gate' ? finalizeGateLine(line, gateByKey) : finalizeNoGateLine(line)))
        wmsReservationIds = gateResult.lines.flatMap((line) => line.reservationIds)
        sideEffects = gateResult.sideEffects
      }

      const reservation = trx.create(AvailabilityReservation, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        idempotencyKey: input.idempotencyKey,
        sourceType: 'checkout',
        sourceId: input.sourceId,
        status: 'active',
        expiresAt,
        items: finalLines.map(toItemSnapshot),
        wmsReservationIds,
      })
      trx.persist(reservation)
      await trx.flush()

      return { reservationId: reservation.id, finalLines, sideEffects }
    })
  } catch (err) {
    if (err instanceof ReserveShortfallSignal) {
      await emitAvailabilityEvent(
        'availability.shortfall.detected',
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          sourceType: 'checkout',
          sourceId: input.sourceId,
          reason: 'reserve',
          lines: err.shortfall,
        },
        { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
      const shortfallByKey = new Map(err.shortfall.map((line) => [availabilityItemKey(line), { key: availabilityItemKey(line), requested: line.requested, sellable: line.available }]))
      return {
        reserved: false,
        reservationId: null,
        status: null,
        expiresAt: null,
        lines: classified.map((line) => zeroLine(line, shortfallByKey)),
        shortfall: err.shortfall,
      }
    }
    if (isUniqueViolation(err)) {
      const raced = await em.findOne(AvailabilityReservation, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        idempotencyKey: input.idempotencyKey,
      })
      if (raced) return replayOrThrowMismatch(raced, input.sourceId, normalizedItems)
    }
    throw err
  }

  if (wmsService) await wmsService.emitSideEffects(ctx, outcome.sideEffects)
  await emitAvailabilityEvent(
    'availability.reservation.created',
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      reservationId: outcome.reservationId,
      sourceType: 'checkout',
      sourceId: input.sourceId,
      lines: outcome.finalLines.map((line) => ({
        catalogProductId: line.catalogProductId,
        catalogVariantId: line.catalogVariantId,
        heldQuantity: line.heldQuantity,
      })),
    },
    { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
  )

  return {
    reserved: true,
    reservationId: outcome.reservationId,
    status: 'active',
    expiresAt: expiresAt.toISOString(),
    lines: outcome.finalLines,
    shortfall: [],
  }
}

const OPEN_POLICY_DEFAULT: ResolvedAvailabilityPolicy = {
  isStockManaged: { value: true, policySourceId: null },
  allowBackorder: { value: false, policySourceId: null },
  backorderLeadTimeDays: { value: null, policySourceId: null },
  preorderReleaseAt: { value: null, policySourceId: null },
  lowStockThreshold: { value: null, policySourceId: null },
  minOrderQuantity: { value: null, policySourceId: null },
  maxOrderQuantity: { value: null, policySourceId: null },
  quantityIncrement: { value: null, policySourceId: null },
  hideWhenOutOfStock: { value: false, policySourceId: null },
  isActive: { value: true, policySourceId: null },
}

/**
 * `availability.release` (§4.1, A21). CAS `active → released`; a non-`active` hold (or an
 * unknown key) is a no-op returning its current status, so a compensation retry is safe.
 */
export async function releaseAvailability(
  container: Resolver,
  rawInput: unknown,
): Promise<ReleaseAvailabilityResult> {
  const input: AvailabilityReleaseInput = availabilityReleaseInputSchema.parse(rawInput)
  const scope: ReservationScope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const em = (container.resolve('em') as EntityManager).fork()
  const wmsService = tryResolveWmsService(container)
  const ctx = buildServiceCtx(container, scope, 'availability.release')

  const lookup = await em.findOne(AvailabilityReservation, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    idempotencyKey: input.idempotencyKey,
  })
  if (!lookup) return { reservationId: null, status: 'not_found', released: false }
  if (lookup.status !== 'active') {
    return { reservationId: lookup.id, status: lookup.status, released: false }
  }

  let finalStatus: AvailabilityReservationStatus = lookup.status
  let released = false
  let sideEffects: WmsSideEffectsLike = {}
  let reservationSnapshot = lookup

  await em.transactional(async (trx) => {
    const affected = await trx.nativeUpdate(
      AvailabilityReservation,
      { id: lookup.id, status: 'active' },
      { status: 'released', statusReason: input.reason, updatedAt: new Date() },
    )
    if (affected === 0) {
      const fresh = await trx.findOne(AvailabilityReservation, { id: lookup.id })
      finalStatus = fresh?.status ?? lookup.status
      return
    }
    if (wmsService) {
      for (const wmsReservationId of lookup.wmsReservationIds) {
        const result = await wmsService.releaseInTransaction(trx, ctx, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          reservationId: wmsReservationId,
          reason: input.reason,
        })
        sideEffects = mergeSideEffects(sideEffects, {
          reservations: [{ entity: result.reservationEntity, action: 'updated' }],
          balances: result.touchedBalances.map((entity) => ({ entity, action: 'updated' as const })),
        })
      }
    }
    finalStatus = 'released'
    released = true
    reservationSnapshot = lookup
  })

  if (released) {
    if (wmsService) await wmsService.emitSideEffects(ctx, sideEffects)
    await emitAvailabilityEvent(
      'availability.reservation.released',
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        reservationId: reservationSnapshot.id,
        sourceType: 'checkout',
        sourceId: reservationSnapshot.sourceId,
        lines: reservationSnapshot.items.map((item) => ({
          catalogProductId: item.catalogProductId,
          catalogVariantId: item.catalogVariantId,
          heldQuantity: item.heldQuantity,
        })),
        reason: input.reason,
      },
      { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
  }

  return { reservationId: lookup.id, status: finalStatus, released }
}

async function createStockLostNotification(
  container: Resolver,
  scope: ReservationScope,
  orderId: string,
  shortfall: AvailabilityShortfallLine[],
): Promise<void> {
  const typeDef = notificationTypes.find((type) => type.type === 'availability.stock_lost_after_payment')
  if (!typeDef) return
  try {
    const notificationService = resolveNotificationService(container)
    await notificationService.createForFeature(
      buildFeatureNotificationFromType(typeDef, {
        requiredFeature: 'availability.policies.manage',
        bodyVariables: { orderId, sellableCount: String(shortfall.length) },
        sourceEntityType: 'availability:reservation',
        sourceEntityId: orderId,
        groupKey: `availability.stock_lost_after_payment:${orderId}`,
      }),
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
  } catch {
    // Best-effort — never let a notification failure mask the (already surfaced) event.
  }
}

/**
 * `availability.commit` (§4.1, D-R5-8). CAS `active → committed`; converts the `wms` rows
 * in place (never releases first). When the sweep already won, tries ONE fresh gated
 * reserve written directly as `order` rows (recovery); a shortfall there is `stock_lost`,
 * surfaced via an event and an ops notification, never silently.
 */
export async function commitAvailability(
  container: Resolver,
  rawInput: unknown,
): Promise<CommitAvailabilityResult> {
  const input: AvailabilityCommitInput = availabilityCommitInputSchema.parse(rawInput)
  const scope: ReservationScope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const em = (container.resolve('em') as EntityManager).fork()
  const wmsService = tryResolveWmsService(container)
  const ctx = buildServiceCtx(container, scope, 'availability.commit')

  const reservation = await em.findOne(AvailabilityReservation, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    idempotencyKey: input.idempotencyKey,
  })
  if (!reservation) throw new CrudHttpError(404, { error: 'reservation_not_found' })

  if (reservation.status === 'committed') {
    if (reservation.orderId === input.orderId) return { reservationId: reservation.id, status: 'committed', shortfall: [] }
    throw new CrudHttpError(409, { error: 'idempotency_key_mismatch' })
  }

  if (reservation.status === 'active') {
    let won = false
    let sideEffects: WmsSideEffectsLike = {}
    await em.transactional(async (trx) => {
      const affected = await trx.nativeUpdate(
        AvailabilityReservation,
        { id: reservation.id, status: 'active' },
        { status: 'committed', orderId: input.orderId, updatedAt: new Date() },
      )
      if (affected === 0) return
      won = true
      if (wmsService) {
        for (const wmsReservationId of reservation.wmsReservationIds) {
          const result = await wmsService.convertInTransaction(trx, ctx, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            reservationId: wmsReservationId,
            sourceType: 'order',
            sourceId: input.orderId,
          })
          sideEffects = mergeSideEffects(sideEffects, {
            reservations: [{ entity: result.reservationEntity, action: 'updated' }],
          })
        }
      }
    })

    if (won) {
      if (wmsService) await wmsService.emitSideEffects(ctx, sideEffects)
      await emitAvailabilityEvent(
        'availability.reservation.committed',
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          reservationId: reservation.id,
          sourceType: 'checkout',
          sourceId: reservation.sourceId,
          orderId: input.orderId,
          lines: reservation.items.map((item) => ({
            catalogProductId: item.catalogProductId,
            catalogVariantId: item.catalogVariantId,
            heldQuantity: item.heldQuantity,
          })),
        },
        { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
      return { reservationId: reservation.id, status: 'committed', shortfall: [] }
    }
    // Lost the CAS race to the expiry sweep between our read and our update — fall through
    // to the recovery path below with a fresh read.
    const fresh = await em.findOne(AvailabilityReservation, { id: reservation.id })
    if (fresh) return commitRecovery(container, em, ctx, wmsService, scope, fresh, input.orderId)
  }

  return commitRecovery(container, em, ctx, wmsService, scope, reservation, input.orderId)
}

async function commitRecovery(
  container: Resolver,
  em: EntityManager,
  ctx: CommandRuntimeContext,
  wmsService: WmsReservationServiceLike | undefined,
  scope: ReservationScope,
  reservation: AvailabilityReservation,
  orderId: string,
): Promise<CommitAvailabilityResult> {
  if (reservation.status === 'committed') {
    if (reservation.orderId === orderId) return { reservationId: reservation.id, status: 'committed', shortfall: [] }
    throw new CrudHttpError(409, { error: 'idempotency_key_mismatch' })
  }

  const stockManagedItems = wmsService
    ? reservation.items.filter((item) => item.outcome === 'held' || item.outcome === 'backorder')
    : []
  const gateLines: GateLineInput[] = stockManagedItems
    .map((item) => ({
      key: availabilityItemKey({ catalogProductId: item.catalogProductId, catalogVariantId: item.catalogVariantId }),
      catalogProductId: item.catalogProductId,
      catalogVariantId: item.catalogVariantId as string,
      quantity: item.heldQuantity,
      mode: 'exact' as const,
    }))
    .filter((line) => line.quantity > 0)

  const gateOutcome: ReserveLinesForCheckoutResultLike = await em.transactional(async (trx) => {
    if (gateLines.length > 0 && wmsService) {
      const result = await wmsService.reserveLinesForCheckout(trx, ctx, {
        scope,
        lines: gateLines,
        sourceType: 'order',
        sourceId: orderId,
        expiresAt: null,
        warehouseIds: null,
      })
      if (!result.ok) return result
      const affected = await trx.nativeUpdate(
        AvailabilityReservation,
        { id: reservation.id, status: reservation.status },
        { status: 'committed', orderId, updatedAt: new Date() },
      )
      if (affected === 0) {
        // A concurrent caller already moved this hold on after we read it — roll back the
        // wms rows the gate just took; nothing should be left dangling.
        throw new CrudHttpError(409, { error: 'commit_conflict' })
      }
      return result
    }
    const affected = await trx.nativeUpdate(
      AvailabilityReservation,
      { id: reservation.id, status: reservation.status },
      { status: 'committed', orderId, updatedAt: new Date() },
    )
    if (affected === 0) {
      throw new CrudHttpError(409, { error: 'commit_conflict' })
    }
    return { ok: true, lines: [], sideEffects: {} }
  })

  if (!gateOutcome.ok) {
    const shortfall: AvailabilityShortfallLine[] = gateOutcome.lines.map((line) => {
      const source = gateLines.find((g) => g.key === line.key)!
      return {
        catalogProductId: source.catalogProductId,
        catalogVariantId: source.catalogVariantId,
        requested: line.requested,
        available: line.sellable,
      }
    })
    await emitAvailabilityEvent(
      'availability.shortfall.detected',
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        sourceType: 'checkout',
        sourceId: reservation.sourceId,
        reason: 'stock_lost_after_payment',
        orderId,
        lines: shortfall,
      },
      { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    await createStockLostNotification(container, scope, orderId, shortfall)
    return { reservationId: reservation.id, status: 'stock_lost', shortfall }
  }

  if (wmsService) await wmsService.emitSideEffects(ctx, gateOutcome.sideEffects)
  await emitAvailabilityEvent(
    'availability.reservation.committed',
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      reservationId: reservation.id,
      sourceType: 'checkout',
      sourceId: reservation.sourceId,
      orderId,
      lines: reservation.items.map((item) => ({
        catalogProductId: item.catalogProductId,
        catalogVariantId: item.catalogVariantId,
        heldQuantity: item.heldQuantity,
      })),
      recovered: true,
    },
    { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  return { reservationId: reservation.id, status: 'recovered', shortfall: [] }
}
