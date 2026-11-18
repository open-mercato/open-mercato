import { randomUUID } from 'node:crypto'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { PropertyManagementSettings } from '../data/entities'
import { settingsSaveSchema, type SettingsSaveInput } from '../data/validators'
import { MANAGE_ALL_BUILDINGS_FEATURE } from '../lib/buildingAccess'
import { conflictError, forbiddenError, unprocessableError } from '../lib/errors'
import { loadSettingsRecord, settingsValuesOf, type SettingsValues } from '../lib/settings'
import { orderStatusEntryExists, salesChannelExists } from '../lib/salesLookups'
import type { Scope } from '../lib/productUse'
import { buildCrudLog, ensureScope, resolveEm } from './shared'

export const SETTINGS_RESOURCE_KIND = 'property_management.settings'

type SettingsUndoPayload = { scope?: Scope; before?: SettingsValues | null; after?: SettingsValues | null }

const MANAGE_FEATURE = 'property_management.manage'

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

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) return true
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === '23505')
}

async function flushSettings(em: EntityManager): Promise<void> {
  try {
    await em.flush()
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    throw await conflictError('property_management.errors.settingsChangedMeanwhile', 'The settings changed meanwhile. Reload and try again.', {
      code: 'settings_changed',
    })
  }
}

type CurrentRecordCheck = (record: PropertyManagementSettings | null) => Promise<void>

async function writeSettings(
  em: EntityManager,
  scope: Scope,
  values: SettingsValues | null,
  checkCurrent?: CurrentRecordCheck,
): Promise<PropertyManagementSettings | null> {
  return em.fork().transactional(async (trx) => {
    const record = await loadSettingsRecord(trx, scope, { lock: true })
    if (checkCurrent) await checkCurrent(record)
    if (!values) {
      if (record) trx.remove(record)
      await trx.flush()
      return null
    }
    const target = record ?? trx.create(PropertyManagementSettings, { id: randomUUID(), ...scope })
    target.billingChannelId = values.billingChannelId
    target.cancelledOrderStatusEntryId = values.cancelledOrderStatusEntryId
    target.leaseEndingThresholdDays = values.leaseEndingThresholdDays
    target.bookingReminderMinutes = values.bookingReminderMinutes
    target.proposalExpiryDays = values.proposalExpiryDays
    target.updatedAt = new Date()
    if (!record) trx.persist(target)
    await flushSettings(trx)
    return target
  })
}

function sameSettings(left: SettingsValues, right: SettingsValues): boolean {
  return (
    (left.billingChannelId ?? null) === (right.billingChannelId ?? null) &&
    (left.cancelledOrderStatusEntryId ?? null) === (right.cancelledOrderStatusEntryId ?? null) &&
    left.leaseEndingThresholdDays === right.leaseEndingThresholdDays &&
    left.bookingReminderMinutes === right.bookingReminderMinutes &&
    left.proposalExpiryDays === right.proposalExpiryDays
  )
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

type RbacLike = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

export const SETTINGS_EDIT_FEATURES = [MANAGE_FEATURE, MANAGE_ALL_BUILDINGS_FEATURE]

function resolveRbac(ctx: CommandRuntimeContext): RbacLike | null {
  try {
    return (ctx.container.resolve('rbacService') as RbacLike | undefined) ?? null
  } catch {
    return null
  }
}

async function assertSettingsEditable(ctx: CommandRuntimeContext, scope: Scope): Promise<void> {
  if (!ctx.auth && ctx.systemActor === true) return
  const rbac = resolveRbac(ctx)
  const allowed = ctx.auth && rbac
    ? await rbac.userHasAllFeatures(ctx.auth.sub, [...SETTINGS_EDIT_FEATURES], { tenantId: scope.tenantId, organizationId: scope.organizationId })
    : false
  if (allowed) return
  throw await forbiddenError(
    'property_management.errors.settingsForbidden',
    'Only users who manage every building can change the property management settings.',
    { code: 'settings_forbidden' },
  )
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
    await assertSettingsEditable(ctx, scope)
    const em = resolveEm(ctx)
    const values = valuesOf(parsed)
    await assertReferences(em, scope, values)
    const record = await writeSettings(em, scope, values, async (current) => {
      if (!current) return
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: SETTINGS_RESOURCE_KIND,
        resourceId: current.id,
        current: current.updatedAt,
        request: ctx.request ?? null,
      })
    })
    return { settingsId: record?.id ?? null }
  },
  captureAfter: async (rawInput, _result, ctx) => {
    const parsed = settingsSaveSchema.parse(rawInput ?? {})
    const record = await loadSettingsRecord(resolveEm(ctx).fork(), { tenantId: parsed.tenantId, organizationId: parsed.organizationId })
    return record ? settingsValuesOf(record) : null
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.settingsId ?? null, 'property_management.audit.settings.save', 'Save property management settings', SETTINGS_RESOURCE_KIND)
    const scope = input ? { tenantId: input.tenantId, organizationId: input.organizationId } : undefined
    const before = (snapshots?.before ?? null) as SettingsValues | null
    const after = (snapshots?.after ?? null) as SettingsValues | null
    return { ...base, payload: { undo: { scope, before, after } satisfies SettingsUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<SettingsUndoPayload>(logEntry)
    if (!payload?.scope) return
    const scope = payload.scope
    ensureScope(ctx, scope)
    await assertSettingsEditable(ctx, scope)
    const em = resolveEm(ctx)
    const before = payload.before ?? null
    if (before) await assertReferences(em, scope, before)
    await writeSettings(em, scope, before, async (current) => {
      if (!payload.after) return
      if (current && sameSettings(settingsValuesOf(current), payload.after)) return
      throw await conflictError('property_management.errors.settingsChangedMeanwhile', 'The settings changed meanwhile. Reload and try again.', {
        code: 'settings_changed',
      })
    })
  },
}

registerCommand(saveSettingsCommand)
