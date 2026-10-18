import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { DEFAULT_DEAL_STATUS_VOCABULARY, dealStatusVocabularySchema, type DealStatusVocabulary } from '../data/dealStatusVocabulary'

export const DEAL_STATUS_VOCABULARY_CONFIG_KEY = 'dealStatusVocabulary'

export type ResolvedDealStatusVocabulary = {
  vocabulary: DealStatusVocabulary
  source: 'tenant' | 'env' | 'default'
  updatedAt: string | null
}

export async function resolveDealStatusVocabulary(
  container: Pick<AppContainer, 'resolve'> | undefined,
  tenantId: string | null | undefined,
): Promise<ResolvedDealStatusVocabulary> {
  let service: ModuleConfigService | undefined
  if (container && tenantId) {
    try {
      service = container.resolve('moduleConfigService') as ModuleConfigService | undefined
    } catch {}
  }
  const record = service && tenantId
    ? await service.getRecord('customers', DEAL_STATUS_VOCABULARY_CONFIG_KEY, { tenantId })
    : null
  const tenantRecord = record?.source === 'tenant' && record.tenantId === tenantId ? record : null
  const updatedAt = tenantRecord?.updatedAt ?? null
  const configured = dealStatusVocabularySchema.safeParse(tenantRecord?.value)
  if (configured.success) return { vocabulary: configured.data, source: 'tenant', updatedAt }

  let envValue: unknown
  try {
    envValue = JSON.parse(process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY ?? 'null')
  } catch {}
  const envDefault = dealStatusVocabularySchema.safeParse(envValue)
  if (envDefault.success) return { vocabulary: envDefault.data, source: 'env', updatedAt }
  return { vocabulary: DEFAULT_DEAL_STATUS_VOCABULARY, source: 'default', updatedAt }
}
