import { randomUUID } from 'crypto'
import type { FindOneOptions } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { assertFound } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  WarrantyClaim,
  WarrantyClaimEvent,
} from '../data/entities'
import type {
  WarrantyClaimEventKind,
  WarrantyClaimEventVisibility,
} from '../data/validators'

export { assertFound } from '@open-mercato/shared/lib/crud/errors'
export { ensureOrganizationScope, ensureSameScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
export { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'

export const WARRANTY_CLAIM_RESOURCE_KIND = 'warranty_claims.claim'
export const WARRANTY_CLAIM_LINE_RESOURCE_KIND = 'warranty_claims.claim_line'

export type WarrantyClaimScope = {
  organizationId: string
  tenantId: string
}

export type VersionedRecord = {
  id: string
  updatedAt?: Date | string | null
}

export type AppendClaimEventInput = {
  visibility?: WarrantyClaimEventVisibility
  body?: string | null
  payload?: Record<string, unknown> | null
  actorUserId?: string | null
  actorCustomerId?: string | null
}

export async function enforceWarrantyClaimOptimisticLock(
  ctx: CommandRuntimeContext,
  record: VersionedRecord | null | undefined,
  resourceKind = WARRANTY_CLAIM_RESOURCE_KIND,
  expected?: string | Date | null,
): Promise<void> {
  if (!record) return
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind,
    resourceId: record.id,
    current: record.updatedAt ?? null,
    expected,
    request: ctx.request ?? null,
  })
}

export async function loadScopedClaim(
  em: EntityManager,
  id: string,
  scope: WarrantyClaimScope,
  options: FindOneOptions<WarrantyClaim> = {},
): Promise<WarrantyClaim | null> {
  return findOneWithDecryption(
    em,
    WarrantyClaim,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    options,
    scope,
  )
}

export async function requireScopedClaim(
  em: EntityManager,
  id: string,
  scope: WarrantyClaimScope,
  options: FindOneOptions<WarrantyClaim> = {},
): Promise<WarrantyClaim> {
  const claim = await loadScopedClaim(em, id, scope, options)
  return assertFound(claim, 'warranty_claims.errors.notFound')
}

export function appendClaimEvent(
  em: EntityManager,
  claim: WarrantyClaim,
  kind: WarrantyClaimEventKind,
  input: AppendClaimEventInput = {},
): WarrantyClaimEvent {
  const event = em.create(WarrantyClaimEvent, {
    id: randomUUID(),
    claim,
    organizationId: claim.organizationId,
    tenantId: claim.tenantId,
    kind,
    visibility: input.visibility ?? 'internal',
    body: input.body ?? null,
    payload: input.payload ?? null,
    actorUserId: input.actorUserId ?? null,
    actorCustomerId: input.actorCustomerId ?? null,
    createdAt: new Date(),
  })
  em.persist(event)
  return event
}
