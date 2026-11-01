import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges } from '@open-mercato/shared/lib/commands/helpers'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { EcommerceStore } from '../data/entities'
import { ecommerceStoreBrandingSchema, type EcommerceStoreBranding } from '../data/validators'
import { announceStoreBrandingUpdated } from '../lib/crudEvents'
import {
  compactBranding,
  mergeBrandingIntoSettings,
  STORE_BRANDING_RESOURCE_KIND,
  STORE_BRANDING_UPDATE_COMMAND_ID,
} from '../lib/storeBranding'

export type StoreBrandingUpdateInput = {
  id: string
  tenantId: string
  organizationId: string
  branding: EcommerceStoreBranding
}

export type StoreBrandingUpdateResult = {
  id: string
  updatedAt: string
  branding: EcommerceStoreBranding
}

type StoreBrandingSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  branding: EcommerceStoreBranding
  updatedAt: string
}

type StoreBrandingUndoPayload = {
  before?: StoreBrandingSnapshot | null
  after?: StoreBrandingSnapshot | null
}

const BRANDING_CHANGE_KEYS = ['branding'] as const

async function loadStore(
  em: EntityManager,
  scope: { id: string; tenantId: string; organizationId: string },
): Promise<EcommerceStore | null> {
  return findOneWithDecryption(
    em,
    EcommerceStore,
    { id: scope.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

function toSnapshot(store: EcommerceStore): StoreBrandingSnapshot {
  return {
    id: store.id,
    tenantId: store.tenantId,
    organizationId: store.organizationId,
    branding: compactBranding(store.settings?.branding ?? {}),
    updatedAt: store.updatedAt.toISOString(),
  }
}

async function loadSnapshot(
  ctx: { container: { resolve: (name: string) => unknown } },
  scope: { id: string; tenantId: string; organizationId: string },
): Promise<StoreBrandingSnapshot | null> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const store = await loadStore(em, scope)
  return store ? toSnapshot(store) : null
}

const updateStoreBrandingCommand: CommandHandler<StoreBrandingUpdateInput, StoreBrandingUpdateResult> = {
  id: STORE_BRANDING_UPDATE_COMMAND_ID,

  async prepare(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const snapshot = await loadSnapshot(ctx, input)
    return snapshot ? { before: snapshot } : {}
  },

  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const branding = compactBranding(ecommerceStoreBrandingSchema.parse(input.branding))
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const store = await loadStore(em, input)
    if (!store) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(404, {
        error: translate('ecommerce.errors.storeNotFound', 'The selected store does not exist in this organization.'),
      })
    }
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: STORE_BRANDING_RESOURCE_KIND,
      resourceId: store.id,
      current: store.updatedAt,
      request: ctx.request,
    })
    store.settings = mergeBrandingIntoSettings(store.settings, branding)
    await em.flush()
    await announceStoreBrandingUpdated(ctx.container, store)
    return { id: store.id, updatedAt: store.updatedAt.toISOString(), branding }
  },

  async captureAfter(input, _result, ctx) {
    return loadSnapshot(ctx, input)
  },

  async buildLog({ snapshots, input }) {
    const before = snapshots.before as StoreBrandingSnapshot | undefined
    const after = snapshots.after as StoreBrandingSnapshot | undefined
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('ecommerce.audit.stores.branding.update', 'Update store branding'),
      resourceKind: STORE_BRANDING_RESOURCE_KIND,
      resourceId: before.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(before, after, BRANDING_CHANGE_KEYS),
      payload: {
        undo: { before, after } satisfies StoreBrandingUndoPayload,
      },
    }
  },

  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<StoreBrandingUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const store = await loadStore(em, before)
    if (!store) return
    store.settings = mergeBrandingIntoSettings(store.settings, before.branding)
    await em.flush()
    await announceStoreBrandingUpdated(ctx.container, store)
  },
}

registerCommand(updateStoreBrandingCommand)
