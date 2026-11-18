import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { PropertyManagementSettings } from '../data/entities'
import type { Scope } from './productUse'

export type SettingsValues = {
  billingChannelId: string | null
  cancelledOrderStatusEntryId: string | null
  leaseEndingThresholdDays: number
  bookingReminderMinutes: number
  proposalExpiryDays: number
}

export const DEFAULT_SETTINGS: SettingsValues = {
  billingChannelId: null,
  cancelledOrderStatusEntryId: null,
  leaseEndingThresholdDays: 60,
  bookingReminderMinutes: 60,
  proposalExpiryDays: 14,
}

export function settingsValuesOf(record: PropertyManagementSettings | null): SettingsValues {
  if (!record) return { ...DEFAULT_SETTINGS }
  return {
    billingChannelId: record.billingChannelId ?? null,
    cancelledOrderStatusEntryId: record.cancelledOrderStatusEntryId ?? null,
    leaseEndingThresholdDays: record.leaseEndingThresholdDays,
    bookingReminderMinutes: record.bookingReminderMinutes,
    proposalExpiryDays: record.proposalExpiryDays,
  }
}

export async function loadSettingsRecord(
  em: EntityManager,
  scope: Scope,
  options: { lock?: boolean } = {},
): Promise<PropertyManagementSettings | null> {
  const findOptions = options.lock ? { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true } : undefined
  return findOneWithDecryption(em, PropertyManagementSettings, { ...scope }, findOptions, scope)
}

export async function loadSettings(em: EntityManager, scope: Scope): Promise<SettingsValues> {
  return settingsValuesOf(await loadSettingsRecord(em, scope))
}
