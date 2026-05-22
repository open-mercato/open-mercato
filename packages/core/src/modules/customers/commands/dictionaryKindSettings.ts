import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDictionaryKindSetting } from '../data/entities'
import {
  customerKindSettingsUpsertSchema,
  type CustomerKindSettingsUpsertInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
} from './shared'

const KIND_SETTING_ENTITY_TYPE = 'customers:customer_dictionary_kind_setting'

type KindSettingSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  kind: string
  selectionMode: string
  visibleInTags: boolean
  sortOrder: number
}

type KindSettingUndoPayload = {
  before?: KindSettingSnapshot | null
  after?: KindSettingSnapshot | null
}

type KindSettingUpsertResult = {
  settingId: string
  created: boolean
  kind: string
  selectionMode: string
  visibleInTags: boolean
  sortOrder: number
}

const kindSettingCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'dictionary_kind_setting',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
    kind:
      ctx.entity && typeof ctx.entity === 'object' && 'kind' in (ctx.entity as Record<string, unknown>)
        ? (ctx.entity as CustomerDictionaryKindSetting).kind
        : null,
    ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
  }),
}

function getKindSettingIdentifiers(setting: CustomerDictionaryKindSetting) {
  return {
    id: setting.id,
    organizationId: setting.organizationId,
    tenantId: setting.tenantId,
  }
}

function toSnapshot(setting: CustomerDictionaryKindSetting): KindSettingSnapshot {
  return {
    id: setting.id,
    tenantId: setting.tenantId,
    organizationId: setting.organizationId,
    kind: setting.kind,
    selectionMode: setting.selectionMode,
    visibleInTags: setting.visibleInTags,
    sortOrder: setting.sortOrder,
  }
}

async function loadSnapshotByKind(
  em: EntityManager,
  params: { tenantId: string; organizationId: string; kind: string },
): Promise<KindSettingSnapshot | null> {
  const existing = await findOneWithDecryption(
    em,
    CustomerDictionaryKindSetting,
    {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      kind: params.kind,
    },
    undefined,
    { tenantId: params.tenantId, organizationId: params.organizationId },
  )
  return existing ? toSnapshot(existing) : null
}

async function loadSnapshotById(
  em: EntityManager,
  id: string,
  scope: { tenantId: string; organizationId: string },
): Promise<KindSettingSnapshot | null> {
  const existing = await findOneWithDecryption(
    em,
    CustomerDictionaryKindSetting,
    { id },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  return existing ? toSnapshot(existing) : null
}

const upsertKindSettingCommand: CommandHandler<CustomerKindSettingsUpsertInput, KindSettingUpsertResult> = {
  id: 'customers.dictionaryKindSettings.upsert',
  async prepare(rawInput, ctx) {
    const parsed = customerKindSettingsUpsertSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadSnapshotByKind(em, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      kind: parsed.kind,
    })
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = customerKindSettingsUpsertSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let setting = await findOneWithDecryption(
      em,
      CustomerDictionaryKindSetting,
      {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        kind: parsed.kind,
      },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )

    const created = !setting
    if (!setting) {
      setting = em.create(CustomerDictionaryKindSetting, {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        kind: parsed.kind,
        selectionMode: parsed.selectionMode ?? 'single',
        visibleInTags: parsed.visibleInTags ?? true,
        sortOrder: parsed.sortOrder ?? 0,
      })
      em.persist(setting)
    } else {
      if (parsed.selectionMode !== undefined) setting.selectionMode = parsed.selectionMode
      if (parsed.visibleInTags !== undefined) setting.visibleInTags = parsed.visibleInTags
      if (parsed.sortOrder !== undefined) setting.sortOrder = parsed.sortOrder
    }

    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: created ? 'created' : 'updated',
      entity: setting,
      identifiers: getKindSettingIdentifiers(setting),
      syncOrigin: ctx.syncOrigin,
      events: kindSettingCrudEvents,
      indexer: { entityType: KIND_SETTING_ENTITY_TYPE },
    })

    return {
      settingId: setting.id,
      created,
      kind: setting.kind,
      selectionMode: setting.selectionMode,
      visibleInTags: setting.visibleInTags,
      sortOrder: setting.sortOrder,
    }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    const tenantId = ctx.auth?.tenantId ?? null
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    if (!tenantId || !organizationId) return null
    return loadSnapshotById(em, result.settingId, { tenantId, organizationId })
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as KindSettingSnapshot | undefined
    const after = snapshots.after as KindSettingSnapshot | undefined
    const actionKey = result.created
      ? 'customers.audit.dictionaryKindSettings.create'
      : 'customers.audit.dictionaryKindSettings.update'
    const actionFallback = result.created
      ? 'Create dictionary kind setting'
      : 'Update dictionary kind setting'
    return {
      actionLabel: translate(actionKey, actionFallback),
      resourceKind: 'customers.dictionaryKindSetting',
      resourceId: result.settingId,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          before: before ?? null,
          after: after ?? null,
        } satisfies KindSettingUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<KindSettingUndoPayload>(logEntry)
    const before = payload?.before ?? null
    const after = payload?.after ?? null
    if (!after) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const setting = await findOneWithDecryption(
      em,
      CustomerDictionaryKindSetting,
      { id: after.id },
      undefined,
      { tenantId: after.tenantId, organizationId: after.organizationId },
    )
    if (!setting) return

    if (!before) {
      em.remove(setting)
      await em.flush()

      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'deleted',
        entity: setting,
        identifiers: getKindSettingIdentifiers(setting),
        syncOrigin: ctx.syncOrigin,
        events: kindSettingCrudEvents,
        indexer: { entityType: KIND_SETTING_ENTITY_TYPE },
      })
      return
    }

    setting.selectionMode = before.selectionMode
    setting.visibleInTags = before.visibleInTags
    setting.sortOrder = before.sortOrder
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: setting,
      identifiers: getKindSettingIdentifiers(setting),
      syncOrigin: ctx.syncOrigin,
      events: kindSettingCrudEvents,
      indexer: { entityType: KIND_SETTING_ENTITY_TYPE },
    })
  },
}

registerCommand(upsertKindSettingCommand)
