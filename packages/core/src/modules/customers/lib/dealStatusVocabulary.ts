import { createLogger } from '@open-mercato/shared/lib/logger'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { DEFAULT_DEAL_STATUS_VOCABULARY, dealStatusVocabularySchema, type DealStatusVocabulary } from '../data/dealStatusVocabulary'

export const DEAL_STATUS_VOCABULARY_CONFIG_KEY = 'dealStatusVocabulary'
export const DEAL_STATUS_VOCABULARY_RESOURCE_KIND = 'customers.deal_status_vocabulary'

export type ResolvedDealStatusVocabulary = {
  vocabulary: DealStatusVocabulary
  source: 'tenant' | 'env' | 'default'
  updatedAt: string | null
}

const logger = createLogger('customers').child({ component: 'deal-status-vocabulary' })
let cachedEnvironment: { raw: string | undefined; vocabulary: DealStatusVocabulary | null } | undefined

function resolveEnvironmentVocabulary(): DealStatusVocabulary | null {
  const raw = process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY
  if (cachedEnvironment && cachedEnvironment.raw === raw) return cachedEnvironment.vocabulary
  let value: unknown
  try {
    value = raw ? JSON.parse(raw) : null
  } catch {}
  const parsed = dealStatusVocabularySchema.safeParse(value)
  cachedEnvironment = { raw, vocabulary: parsed.success ? parsed.data : null }
  if (raw && !parsed.success) logger.warn('Invalid OM_CUSTOMERS_DEAL_STATUS_VOCABULARY; using built-in defaults')
  return cachedEnvironment.vocabulary
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

  const envDefault = resolveEnvironmentVocabulary()
  if (envDefault) return { vocabulary: envDefault, source: 'env', updatedAt }
  return { vocabulary: DEFAULT_DEAL_STATUS_VOCABULARY, source: 'default', updatedAt }
}
