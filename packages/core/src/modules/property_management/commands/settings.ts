import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { PropertyManagementSettings } from '../data/entities'
import { settingsSaveSchema, type SettingsSaveInput } from '../data/validators'
import { unprocessableError } from '../lib/errors'
import { loadSettingsRecord, settingsValuesOf, type SettingsValues } from '../lib/settings'
import { orderStatusEntryExists, salesChannelExists } from '../lib/salesLookups'
import type { Scope } from '../lib/productUse'
import { buildCrudLog, ensureScope, resolveEm } from './shared'

export const SETTINGS_RESOURCE_KIND = 'property_management.settings'

type SettingsUndoPayload = { scope?: Scope; before?: SettingsValues | null }

async function assertReferences(em: EntityManager, scope: Scope, values: SettingsValues): Promise<void> {
  if (values.billingChannelId && !(await salesChannelExists(em, scope, values.billingChannelId))) {
    throw await unprocessableError('property_management.errors.billingChannelInvalid', 'The sales channel is not a channel of this organization.', {
      fieldErrors: { billingChannelId: 'property_management.errors.billingChannelInvalid' },
    })
  }
  if (values.cancelledOrderStatusEntryId && !(await orderStatusEntryExists(em, scope, values.cancelledOrderStatusEntryId))) {
    throw await unprocessableError('property_management.errors.cancelledStatusInvalid', 'The order status is not a sales order status of this organization.', {
      fieldErrors: { cancelledOrderStatusEntryId: 'property_management.errors.cancelledStatusInvalid' },
    })
  }
}

async function writeSettings(em: EntityManager, scope: Scope, values: SettingsValues | null): Promise<PropertyManagementSettings | null> {
  const record = await loadSettingsRecord(em, scope)
  if (!values) {
    if (record) em.remove(record)
    await em.flush()
    return null
  }
  const target = record ?? em.create(PropertyManagementSettings, { id: randomUUID(), ...scope })
  target.billingChannelId = values.billingChannelId
  target.cancelledOrderStatusEntryId = values.cancelledOrderStatusEntryId
  target.leaseEndingThresholdDays = values.leaseEndingThresholdDays
  target.bookingReminderMinutes = values.bookingReminderMinutes
  target.proposalExpiryDays = values.proposalExpiryDays
  target.updatedAt = new Date()
  if (!record) em.persist(target)
  await em.flush()
  return target
}

function valuesOf(input: SettingsSaveInput): SettingsValues {
  return {
    billingChannelId: input.billingChannelId,
    cancelledOrderStatusEntryId: input.cancelledOrderStatusEntryId,
    leaseEndingThresholdDays: input.leaseEndingThresholdDays,
    bookingReminderMinutes: input.bookingReminderMinutes,
    proposalExpiryDays: input.proposalExpiryDays,
  }
}

const saveSettingsCommand: CommandHandler<SettingsSaveInput, { settingsId: string | null }> = {
  id: 'property_management.settings.save',
  prepare: async (rawInput, ctx) => {
    const parsed = settingsSaveSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const record = await loadSettingsRecord(resolveEm(ctx), scope)
    return { before: record ? settingsValuesOf(record) : null }
  },
  async execute(rawInput, ctx) {
    const parsed = settingsSaveSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const values = valuesOf(parsed)
    const existing = await loadSettingsRecord(em, scope)
    if (existing) {
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: SETTINGS_RESOURCE_KIND,
        resourceId: existing.id,
        current: existing.updatedAt,
        request: ctx.request ?? null,
      })
    }
    await assertReferences(em, scope, values)
    const record = await writeSettings(em, scope, values)
    return { settingsId: record?.id ?? null }
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.settingsId ?? null, 'property_management.audit.settings.save', 'Save property management settings', SETTINGS_RESOURCE_KIND)
    const scope = input ? { tenantId: input.tenantId, organizationId: input.organizationId } : undefined
    const before = (snapshots?.before ?? null) as SettingsValues | null
    return { ...base, payload: { undo: { scope, before } satisfies SettingsUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<SettingsUndoPayload>(logEntry)
    if (!payload?.scope) return
    ensureScope(ctx, payload.scope)
    await writeSettings(resolveEm(ctx), payload.scope, payload.before ?? null)
  },
}

registerCommand(saveSettingsCommand)
