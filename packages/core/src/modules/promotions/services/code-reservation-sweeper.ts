import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CodeReservation } from '../data/entities'

// SPEC-055's own file-tree listing names this file `services/code-reservation-sweeper.ts`
// (rev A.6/X7) and its Reservation-TTL risk-mitigation text spells out WHY it exists
// alongside `cart`'s own expiry/abandonment sweepers (`cart/lib/sweepers.ts`), which already
// call `codes/release` (Step 6.2's `releaseCode`) when a CART itself expires or is abandoned:
// "a reservation must not depend on another module's job succeeding." This sweeper is
// `promotions`' OWN independent safety net — it never touches `cart`'s tables, and `cart`'s
// sweepers are left completely alone. Either mechanism releasing a lapsed reservation is
// sufficient on its own; both exist on purpose.
//
// Shape mirrors `cart/lib/sweepers.ts`: a plain, DI-free sweep function, paged via
// `findWithDecryption` + a bulk delete, re-running the identical query per page. No keyset
// cursor is needed here — unlike `cart`'s own `purgeExpiredCarts` (which must skip rows a
// `CartMergeLog` still references), every row this sweep selects is deleted outright, so it
// never stays in the next page's candidate set. `CodeReservation` is not encrypted (plain
// uuid/text/timestamp columns — see `data/entities.ts`), but `findWithDecryption` is still the
// house helper for a tenant-scoped find, same as `cart`'s own sweepers use it unconditionally.

// Mirrors `cart/lib/sweepers.ts`'s own `SWEEP_PAGE_SIZE`/`MAX_PAGES_PER_TICK` reasoning: the
// reservation backlog grows with active carts, so a tick walks it in pages instead of loading
// every lapsed row at once, with a defensive circuit breaker so one tick can never spin forever
// against a pathological backlog.
const SWEEP_PAGE_SIZE = 500
const MAX_PAGES_PER_TICK = 1000

export type CodeReservationSweepScope = { tenantId: string }
export type CodeReservationSweepResult = { released: number }

/**
 * §Data Models rev C7/D-R4-8: "a reservation must not depend on another module's job
 * succeeding" (§Reservation TTL risk mitigation). Finds every `CodeReservation` row whose
 * `expiresAt` has lapsed for this tenant (across every organization under it, same as
 * `cart`'s own tenant-scoped sweeps) and hard-deletes it — `CodeReservation` has no
 * `updatedAt`/`deletedAt` (it is a session/token-like row, root `AGENTS.md`'s optimistic-lock
 * exemption list), so a straight delete is the correct release, matching
 * `code-service.ts#releaseCode`'s own `nativeDelete`.
 *
 * No cursor: each page's delete removes every row the page just selected, so the identical
 * next `find` call naturally excludes them and returns the next batch of still-lapsed rows —
 * there is nothing left for a page to re-select, same reasoning as `cart`'s
 * `sweepAbandonedCarts`/`sweepExpiredCarts`.
 */
export async function sweepExpiredCodeReservations(
  em: EntityManager,
  scope: CodeReservationSweepScope,
  now: Date = new Date(),
): Promise<CodeReservationSweepResult> {
  let released = 0

  for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
    const candidates = await findWithDecryption(
      em,
      CodeReservation,
      { tenantId: scope.tenantId, expiresAt: { $lte: now } },
      { limit: SWEEP_PAGE_SIZE, orderBy: { id: 'ASC' } },
      { tenantId: scope.tenantId },
    )
    if (!candidates.length) break

    const ids = candidates.map((reservation) => reservation.id)
    const affected = await em.nativeDelete(CodeReservation, { id: { $in: ids }, tenantId: scope.tenantId })
    if (affected === 0) break

    released += affected
    if (candidates.length < SWEEP_PAGE_SIZE) break
  }

  return { released }
}
