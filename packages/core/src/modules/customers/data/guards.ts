import type { EntityManager } from '@mikro-orm/postgresql'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { parseOptimisticLockEnv } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { getAllOptimisticLockReaders } from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
  OPTIMISTIC_LOCK_ENV_VAR,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

function normalizeIsoToken(raw: string): string | null {
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

/**
 * HTTP header carrying the enterprise `record_locks` conflict resolution the
 * client chose in the merge dialog. This guard only reads the header value off
 * the request (no enterprise import) — it is the integration contract between
 * the record-lock layer and this universal optimistic-lock floor.
 */
const RECORD_LOCK_RESOLUTION_HEADER_NAME = 'x-om-record-lock-resolution'

/**
 * Resolutions that express an explicit, privileged intent to OVERWRITE the
 * incoming concurrent write ("Keep mine" / merged). When the request asserts
 * one of these, the record-lock guard (which runs first, at priority 0) has
 * already authorized the override against `canOverrideIncoming`, so the
 * stale-`updated_at` floor MUST defer to it — otherwise it rejects exactly the
 * overwrite the user just authorized, looping the merge dialog on a fresh 409
 * (issue #3601). `accept_incoming` is intentionally NOT here: that path reloads
 * with a fresh `updated_at` and must still pass through the floor normally.
 */
const RECORD_LOCK_OVERRIDE_RESOLUTIONS: ReadonlySet<string> = new Set(['accept_mine', 'merged'])

export function isAuthorizedRecordLockOverride(headers: Headers): boolean {
  const raw = headers.get(RECORD_LOCK_RESOLUTION_HEADER_NAME)
  if (typeof raw !== 'string') return false
  return RECORD_LOCK_OVERRIDE_RESOLUTIONS.has(raw.trim().toLowerCase())
}

const optimisticLockGuard: MutationGuard = {
  id: 'customers.optimistic-lock',
  targetEntity: '*',
  operations: ['update', 'delete'],
  priority: 100,
  async validate(input) {
    const config = parseOptimisticLockEnv(process.env[OPTIMISTIC_LOCK_ENV_VAR])
    if (config.mode === 'off') return { ok: true }
    // A privileged record-lock "Keep mine" override deliberately overwrites the
    // concurrent write; the floor must not block it on the now-stale timestamp.
    if (isAuthorizedRecordLockOverride(input.requestHeaders)) return { ok: true }
    const enabled = config.mode === 'all' || config.entities.has(input.resourceKind.toLowerCase())
    if (!enabled) return { ok: true }
    const readers = getAllOptimisticLockReaders()
    const reader = readers[input.resourceKind]
    if (!reader) return { ok: true }
    const expectedRaw = input.requestHeaders.get(OPTIMISTIC_LOCK_HEADER_NAME)
    if (!expectedRaw || expectedRaw.trim().length === 0) return { ok: true }
    const expectedIso = normalizeIsoToken(expectedRaw.trim())
    if (!expectedIso) return { ok: true }
    if (!input.resourceId) return { ok: true }
    const container = await createRequestContainer()
    let em: EntityManager
    try {
      em = container.resolve('em') as EntityManager
    } catch {
      return { ok: true }
    }
    const currentRaw = await reader(em, {
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      tenantId: input.tenantId,
      organizationId: input.organizationId ?? null,
    })
    if (currentRaw == null) return { ok: true }
    const currentIso = normalizeIsoToken(currentRaw)
    if (currentIso == null) return { ok: true }
    if (currentIso === expectedIso) return { ok: true }
    return {
      ok: false,
      status: 409,
      body: {
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        currentUpdatedAt: currentIso,
        expectedUpdatedAt: expectedIso,
      },
    }
  },
}

export const guards: MutationGuard[] = [optimisticLockGuard]
