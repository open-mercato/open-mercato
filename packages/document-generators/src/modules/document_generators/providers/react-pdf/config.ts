import { reactPdfConfigSchema, type FontFamilyConfig, type ReactPdfConfig } from '../../data/validators'
import { findProviderConfig, type ResolvedDocumentGeneratorsConfig } from '../../lib/module-config'
import { validateConfig } from '../../utils/validateConfig'
import { REACT_PDF_PROVIDER_ID } from './constants'

export type ResolvedReactPdfConfig = ReactPdfConfig & {
  fonts: FontFamilyConfig[]
}

export const DEFAULT_REACT_PDF_CONFIG: ResolvedReactPdfConfig = {
  fonts: [],
}

const validatedConfigs = new WeakMap<object, ReactPdfConfig>()

export function resolveReactPdfConfig(moduleConfig: ResolvedDocumentGeneratorsConfig): ResolvedReactPdfConfig {
  const raw = findProviderConfig(moduleConfig, REACT_PDF_PROVIDER_ID)
  if (raw === undefined) return DEFAULT_REACT_PDF_CONFIG
  const parsed = validateConfig(raw, reactPdfConfigSchema, validatedConfigs, `"${REACT_PDF_PROVIDER_ID}" provider config`)
  return { ...DEFAULT_REACT_PDF_CONFIG, ...parsed, fonts: parsed.fonts ?? DEFAULT_REACT_PDF_CONFIG.fonts }
}
