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

const optimisticLockGuard: MutationGuard = {
  id: 'customers.optimistic-lock',
  targetEntity: '*',
  operations: ['update', 'delete'],
  priority: 100,
  async validate(input) {
    const config = parseOptimisticLockEnv(process.env[OPTIMISTIC_LOCK_ENV_VAR])
    if (config.mode === 'off') return { ok: true }
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
