import { documentGeneratorsConfigSchema, type DocumentGeneratorsConfig, type DocumentGeneratorsProviderConfig } from '../data/validators'
import { validateConfig } from '../utils/validateConfig'

export const DOCUMENT_GENERATORS_CONFIG_KEY = 'documentGeneratorsConfig'

export type ResolvedDocumentGeneratorsConfig = {
  providers: DocumentGeneratorsProviderConfig[]
}

export const DEFAULT_DOCUMENT_GENERATORS_CONFIG: ResolvedDocumentGeneratorsConfig = {
  providers: [],
}

const validatedModuleConfigs = new WeakMap<object, DocumentGeneratorsConfig>()

export function resolveDocumentGeneratorsConfig(container: { resolve: (name: string) => unknown }): ResolvedDocumentGeneratorsConfig {
  let raw: unknown
  try {
    raw = container.resolve(DOCUMENT_GENERATORS_CONFIG_KEY)
  } catch {
    return DEFAULT_DOCUMENT_GENERATORS_CONFIG
  }
  if (raw === undefined || raw === null) return DEFAULT_DOCUMENT_GENERATORS_CONFIG
  const parsed = validateConfig(raw, documentGeneratorsConfigSchema, validatedModuleConfigs, 'documentGeneratorsConfig')
  return { providers: parsed.providers ?? DEFAULT_DOCUMENT_GENERATORS_CONFIG.providers }
}

export function findProviderConfig(config: ResolvedDocumentGeneratorsConfig, providerId: string): Record<string, unknown> | undefined {
  const provider = config.providers.find((entry) => entry.id === providerId)
  if (!provider) return undefined
  return provider.config ?? {}
}
