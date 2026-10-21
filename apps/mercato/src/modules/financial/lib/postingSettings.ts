import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { PostingSettings } from './postingMap'

export const POSTING_SETTINGS_MODULE = 'financial'
export const POSTING_SETTINGS_KEY = 'posting'

export type PostingSettingsScope = { tenantId: string }

export type PostingSettingsRecord = {
  settings: PostingSettings
  updatedAt: string | null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalize(value: unknown): PostingSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  return {
    receivableAccountCode: asString(raw.receivableAccountCode),
    revenueAccountCode: asString(raw.revenueAccountCode),
    outputVatAccountCode: asString(raw.outputVatAccountCode),
    payableAccountCode: asString(raw.payableAccountCode),
    inputVatAccountCode: asString(raw.inputVatAccountCode),
    cashAccountCode: asString(raw.cashAccountCode),
    bankAccountCode: asString(raw.bankAccountCode),
  }
}

export async function readPostingSettingsRecord(
  service: ModuleConfigService,
  scope: PostingSettingsScope,
): Promise<PostingSettingsRecord> {
  const record = await service.getRecord(POSTING_SETTINGS_MODULE, POSTING_SETTINGS_KEY, scope)
  return {
    settings: normalize(record?.value),
    updatedAt: record?.updatedAt ?? null,
  }
}

export async function writePostingSettings(
  service: ModuleConfigService,
  scope: PostingSettingsScope,
  settings: PostingSettings,
): Promise<PostingSettingsRecord> {
  const record = await service.setValue(POSTING_SETTINGS_MODULE, POSTING_SETTINGS_KEY, settings, scope)
  return {
    settings: normalize(record?.value ?? settings),
    updatedAt: record?.updatedAt ?? null,
  }
}
